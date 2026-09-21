import fsOperation from "fileSystem";
import Url from "utils/Url";
import confirm from "dialogs/confirm";
import toast from "components/toast";
import browser from "plugins/browser";
import runOutputPanel from "components/runOutputPanel";

const cleanPath = (p) => (p ? p.replace(/^file:\/\//, "") : p);

const INTERPRETED = {
  py: { cmd: (f) => `python3 "${f}"`, check: "which python3", install: "apk add --no-cache python3" },
  rb: { cmd: (f) => `ruby "${f}"`, check: "which ruby", install: "apk add --no-cache ruby" },
  php: { cmd: (f) => `php "${f}"`, check: "which php", install: "apk add --no-cache php" },
  pl: { cmd: (f) => `perl "${f}"`, check: "which perl", install: "apk add --no-cache perl" },
  lua: { cmd: (f) => `lua5.3 "${f}"`, check: "which lua5.3", install: "apk add --no-cache lua5.3" },
  sh: { cmd: (f) => `bash "${f}"`, check: "which bash", install: "apk add --no-cache bash" },
  c: { cmd: (f) => `gcc "${f}" -o /tmp/a.out && /tmp/a.out`, check: "which gcc", install: "apk add --no-cache build-base" },
  cpp: { cmd: (f) => `g++ "${f}" -o /tmp/a.out && /tmp/a.out`, check: "which g++", install: "apk add --no-cache build-base" },
  go: { cmd: (f) => `go run "${f}"`, check: "which go", install: "apk add --no-cache go" },
  rs: { cmd: (f) => `rustc "${f}" -o /tmp/a.out && /tmp/a.out`, check: "which rustc", install: "apk add --no-cache rust" },
  java: {
    cmd: (f) => {
      const className = f.replace(/\.java$/, "").split("/").pop();
      return `javac "${f}" && java "${className}"`;
    },
    check: "which javac",
    install: "apk add --no-cache openjdk11",
  },
  ts: { cmd: (f) => `ts-node "${f}"`, check: "which ts-node", install: "apk add --no-cache nodejs npm && npm install -g ts-node" },
};

const NODE_INFO = { check: "which node", install: "apk add --no-cache nodejs npm" };

let currentRunUuid = null;

export async function detectExecutableProject(activeFile, pathName) {
  console.log("[runExecutor] checking", activeFile?.filename, pathName);
  if (!activeFile) return null;

  const filename = activeFile.filename || "";
  const ext = Url.extname(filename).replace(/^\./, "").toLowerCase();

  if (pathName) {
    try {
      const pkgFs = fsOperation(Url.join(pathName, "package.json"));
      if (await pkgFs.exists()) {
        console.log("[runExecutor] package.json found -> node project");
        let pkg = {};
        try { pkg = JSON.parse(await pkgFs.readFile("utf8")); } catch (e) {}
        const scripts = pkg.scripts || {};
        const command = scripts.dev ? "npm run dev" : scripts.start ? "npm start" : "node .";
        return { type: "node", command, cwd: pathName, info: NODE_INFO };
      }
    } catch (err) {
      console.log("[runExecutor] package.json check failed", err);
    }
  }

  if (INTERPRETED[ext]) {
    console.log("[runExecutor] interpreted file matched:", ext);
    return {
      type: ext,
      command: INTERPRETED[ext].cmd(filename),
      cwd: pathName,
      info: INTERPRETED[ext],
    };
  }

  console.log("[runExecutor] no match, not an executable project");
  return null;
}

export async function runWithExecutor(descriptor) {
  console.log("[runExecutor] running", descriptor);
  if (typeof Executor === "undefined") {
    toast("Executor not available");
    return;
  }
  const executor = Executor.BackgroundExecutor || Executor;

  if (descriptor.info) {
    try {
      await executor.execute(descriptor.info.check, true);
    } catch {
      const ok = await confirm("Install required tool", "Install it now to run this project?");
      if (!ok) return;
      try {
        await executor.execute(descriptor.info.install, true);
      } catch (e) {
        toast("Install failed");
        console.log("[runExecutor] install failed", e);
        return;
      }
    }
  }

  const fullCommand = descriptor.cwd
    ? `cd "${cleanPath(descriptor.cwd)}" && ${descriptor.command}`
    : descriptor.command;

  if (currentRunUuid) {
    try {
      await executor.stop(currentRunUuid);
    } catch (err) {
      console.log("[runExecutor] could not stop previous process", err);
    }
    currentRunUuid = null;
  }

  runOutputPanel.show(fullCommand);

  let urlOpened = false;

  const uuid = await executor.start(fullCommand, (type, data) => {
    console.log("[runExecutor:output]", type, data);

    if (type === "stdout" || type === "stderr") {
      runOutputPanel.appendLine(type === "stderr" ? "stderr" : "stdout", data);
    } else if (type === "exit") {
      runOutputPanel.appendLine("exit", `[Exit code: ${data}]`);
      currentRunUuid = null;
    }

    if (!urlOpened && type === "stdout") {
      const m = data.match(/localhost:(\d+)/);
      if (m) {
        urlOpened = true;
        browser.open(`http://localhost:${m[1]}`);
      }
    }
  }, true);

  currentRunUuid = uuid;

  toast("Running...");
  return uuid;
}
