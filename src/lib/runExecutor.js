import fsOperation from "fileSystem";
import Url from "utils/Url";
import confirm from "dialogs/confirm";
import toast from "components/toast";
import browser from "plugins/browser";
import terminalManager from "components/terminal/terminalManager";

const INTERPRETED = {
  py: { cmd: (f) => `python3 "${f}"`, check: "which python3", install: "apk add --no-cache python3" },
  rb: { cmd: (f) => `ruby "${f}"`, check: "which ruby", install: "apk add --no-cache ruby" },
  php: { cmd: (f) => `php "${f}"`, check: "which php", install: "apk add --no-cache php" },
  pl: { cmd: (f) => `perl "${f}"`, check: "which perl", install: "apk add --no-cache perl" },
  lua: { cmd: (f) => `lua5.3 "${f}"`, check: "which lua5.3", install: "apk add --no-cache lua5.3" },
};

const NODE_INFO = { check: "which node", install: "apk add --no-cache nodejs npm" };

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
    ? `cd "${descriptor.cwd}" && ${descriptor.command}`
    : descriptor.command;

  // Create a terminal session for visible output
  let terminalInstance = null;
  try {
    const projectName = descriptor.type === "node"
      ? `Node.js (${descriptor.cwd ? Url.basename(descriptor.cwd) : "project"})`
      : `${descriptor.type.toUpperCase()} Script`;

    terminalInstance = await terminalManager.createLocalTerminal({
      name: projectName,
      render: true,
      serverMode: false,
    });

    terminalInstance.component.write(`\x1b[36m[${new Date().toLocaleTimeString()}]\x1b[0m Running: ${fullCommand}\r\n\r\n`);
  } catch (err) {
    console.error("[runExecutor] failed to create terminal", err);
  }

  let opened = false;
  let exitCode = null;

  const uuid = await executor.start(fullCommand, (type, data) => {
    console.log("[runExecutor:output]", type, data);

    // Write to terminal if available
    if (terminalInstance?.component) {
      if (type === "stdout" || type === "stderr") {
        const color = type === "stderr" ? "\x1b[91m" : "\x1b[0m";
        terminalInstance.component.write(`${color}${data}\x1b[0m`);
      } else if (type === "exit") {
        exitCode = data;
        terminalInstance.component.write(`\r\n\x1b[33m[Exit code: ${data}]\x1b[0m\r\n`);
      }
    }

    // Auto-open browser on localhost URL
    if (!opened && type === "stdout") {
      const m = data.match(/localhost:(\d+)/);
      if (m) {
        opened = true;
        browser.open(`http://localhost:${m[1]}`);
      }
    }
  }, true);

  console.log("[runExecutor] started uuid", uuid);
  toast("Running...");
  return uuid;
}
