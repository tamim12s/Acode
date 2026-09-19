import fsOperation from "fileSystem";
import toast from "components/toast";
import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import dialog from "dialogs/dialog";
import loader from "dialogs/loader";
import helpers from "utils/helpers";
import Url from "utils/Url";

// Get the BackgroundExecutor to isolate from Terminal's foreground executor
// This prevents interference with the terminal service lifecycle
let backgroundExecutor = null;
function getBackgroundExecutor() {
	if (backgroundExecutor) return backgroundExecutor;
	if (typeof Executor !== "undefined" && Executor.BackgroundExecutor) {
		backgroundExecutor = Executor.BackgroundExecutor;
	}
	return backgroundExecutor;
}

/**
 * Detect if the current project is executable (Node.js, Python, etc.)
 * @param {string} activeFilePath - Path to the active file
 * @param {string} folderPath - Path to the containing folder
 * @returns {Promise<{type: 'node'|'python'|null, details: any}>}
 */
async function detectExecutableProject(activeFilePath, folderPath) {
	if (!folderPath) return { type: null, details: null };

	try {
		// Check for package.json (Node.js project)
		const packageJsonPath = Url.join(folderPath, "package.json");
		const fs = fsOperation(packageJsonPath);

		if (await fs.exists()) {
			try {
				const content = await fs.readFile("utf-8");
				const packageJson = JSON.parse(content);
				return {
					type: "node",
					details: {
						scripts: packageJson.scripts || {},
						main: packageJson.main || "index.js",
					},
				};
			} catch (error) {
				console.error("Failed to parse package.json:", error);
			}
		}

		// Check for Python files
		const ext = Url.extname(activeFilePath || "");
		if (ext === ".py") {
			return {
				type: "python",
				details: {
					file: activeFilePath,
				},
			};
		}

		// Check for other interpreted languages
		const interpretedExts = [
			".js",
			".jsx",
			".ts",
			".tsx",
			".rb",
			".php",
			".pl",
			".lua",
		];
		if (interpretedExts.includes(ext)) {
			return {
				type: "script",
				details: {
					file: activeFilePath,
					interpreter: getInterpreterForExt(ext),
				},
			};
		}
	} catch (error) {
		console.error("Error detecting executable project:", error);
	}

	return { type: null, details: null };
}

/**
 * Get interpreter command for file extension
 * @param {string} ext - File extension
 * @returns {string|null}
 */
function getInterpreterForExt(ext) {
	const interpreters = {
		".js": "node",
		".jsx": "node",
		".ts": "npx ts-node",
		".tsx": "npx ts-node",
		".rb": "ruby",
		".php": "php",
		".pl": "perl",
		".lua": "lua",
	};
	return interpreters[ext] || null;
}

/**
 * Check if an interpreter is available in Alpine sandbox
 * @param {string} interpreter - Interpreter command (e.g., "node", "python3")
 * @returns {Promise<boolean>}
 */
async function checkInterpreterAvailable(interpreter) {
	const executor = getBackgroundExecutor();
	if (!executor) return false;

	try {
		const whichCmd = `which ${interpreter}`;
		const result = await executor.execute(whichCmd, true);
		return result.trim().length > 0;
	} catch (error) {
		console.error(`Failed to check for ${interpreter}:`, error);
		return false;
	}
}

/**
 * Install interpreter in Alpine sandbox
 * @param {string} interpreter - Interpreter to install (e.g., "nodejs", "python3")
 * @returns {Promise<boolean>}
 */
async function installInterpreter(interpreter) {
	const executor = getBackgroundExecutor();
	if (!executor) return false;

	const loaderInstance = loader.create("Installing interpreter...");

	try {
		const installCmd = `apk add ${interpreter}`;
		const result = await executor.execute(installCmd, true);
		loaderInstance.destroy();
		return result.includes("OK") || !result.includes("ERROR");
	} catch (error) {
		loaderInstance.destroy();
		console.error(`Failed to install ${interpreter}:`, error);
		return false;
	}
}

/**
 * Determine the command to run for a Node.js project
 * @param {object} packageDetails - Package.json details
 * @returns {string}
 */
function getNodeCommand(packageDetails) {
	const { scripts = {} } = packageDetails;

	// Prefer "dev" script, then "start", then default to "node ."
	if (scripts.dev) return "npm run dev";
	if (scripts.start) return "npm start";
	return "node .";
}

/**
 * Determine the command to run for a Python file
 * @param {object} pythonDetails - Python file details
 * @returns {string}
 */
function getPythonCommand(pythonDetails) {
	const { file } = pythonDetails;
	const filename = Url.basename(file);
	return `python3 "${filename}"`;
}

/**
 * Get installation package name for interpreter
 * @param {string} interpreter - Interpreter command
 * @returns {string}
 */
function getInstallPackageName(interpreter) {
	const packages = {
		node: "nodejs npm",
		nodejs: "nodejs npm",
		python: "python3",
		python3: "python3",
		ruby: "ruby",
		php: "php",
		perl: "perl",
		lua: "lua",
	};
	return packages[interpreter] || interpreter;
}

/**
 * Extract localhost URL from command output
 * @param {string} output - Command output
 * @returns {string|null}
 */
function extractLocalhostUrl(output) {
	// Look for localhost:port patterns
	const localhostPattern =
		/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\d?\]:?)(:\d+)/g;
	const match = localhostPattern.exec(output);

	if (match) {
		// Extract the full URL pattern
		const urlPattern =
			/(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::\])(:\d+)(\/[^\s]*)?/g;
		const urlMatch = urlPattern.exec(output);
		if (urlMatch) {
			const protocol = urlMatch[1] || "http://";
			const host = urlMatch[2];
			const port = urlMatch[3];
			const path = urlMatch[4] || "";
			return `${protocol}${host}${port}${path}`;
		}
		// Return simple localhost:port if no full URL found
		return `http://${match[0]}`;
	}

	return null;
}

/**
 * Create a terminal page for output display
 * @param {string} processId - Process UUID from Executor
 * @param {string} projectName - Name of the project/terminal
 * @returns {Promise<object>} Terminal instance
 */
async function createTerminalPage(processId, projectName) {
	// Use existing terminal manager if available
	if (window.TerminalManager) {
		const terminalManager = new window.TerminalManager();
		return await terminalManager.createTerminal({
			name: projectName,
			pid: processId,
			serverMode: false, // Don't use server mode since we're managing the process
			render: true,
		});
	}

	// Fallback: create a simple terminal-like interface
	const $page = document.createElement("div");
	$page.className = "terminal-output";
	$page.innerHTML = `
    <div style="padding: 1rem; background: var(--secondary-color);">
      <h3 style="margin: 0 0 0.5rem 0;">${helpers.escapeHtml(projectName)}</h3>
      <div id="output-${processId}" style="font-family: monospace; white-space: pre-wrap; background: black; color: white; padding: 1rem; border-radius: 4px; max-height: 400px; overflow-y: auto;"></div>
    </div>
  `;

	return {
		element: $page,
		outputElement: $page.querySelector(`#output-${processId}`),
	};
}

/**
 * Run an executable project using Executor
 * @param {object} projectInfo - Project information from detectExecutableProject
 * @param {string} folderPath - Path to the project folder
 * @param {Function} openBrowser - Function to open browser (from run.js)
 * @returns {Promise<boolean>} Success status
 */
export async function runWithExecutor(projectInfo, folderPath, openBrowser) {
	const executor = getBackgroundExecutor();
	if (!executor) {
		alert(
			"Terminal plugin not available",
			"The Terminal plugin is required to run executable projects. Please ensure the Terminal plugin is installed and enabled.",
		);
		return false;
	}

	const { type, details } = projectInfo;

	// Determine command and interpreter
	let command;
	let interpreter;

	switch (type) {
		case "node":
			command = getNodeCommand(details);
			interpreter = "node";
			break;
		case "python":
			command = getPythonCommand(details);
			interpreter = "python3";
			break;
		case "script":
			command = `${details.interpreter} "${Url.basename(details.file)}"`;
			interpreter = details.interpreter.split(" ")[0]; // Get base interpreter (e.g., "node" from "npx ts-node")
			break;
		default:
			return false;
	}

	// Check if interpreter is available
	const isAvailable = await checkInterpreterAvailable(interpreter);

	if (!isAvailable) {
		const installPackage = getInstallPackageName(interpreter);
		const shouldInstall = await confirm(
			"Missing interpreter",
			`The ${interpreter} interpreter is not available in the Alpine sandbox. Would you like to install ${installPackage}? This requires an internet connection.`,
		);

		if (!shouldInstall) return false;

		const loaderInstance = loader.create(`Installing ${installPackage}...`);
		const success = await installInterpreter(installPackage);
		loaderInstance.destroy();

		if (!success) {
			alert(
				"Installation failed",
				`Failed to install ${installPackage}. Please check your internet connection and try again.`,
			);
			return false;
		}

		toast(`Successfully installed ${installPackage}`);
	}

	// Change directory to project folder in Alpine sandbox
	const alpinePath = folderPath.replace(/^file:\/\//, "");
	const cdCommand = `cd "${alpinePath}"`;

	// Create terminal page for output
	const projectName =
		type === "node"
			? `Node.js Project (${Url.basename(folderPath)})`
			: type === "python"
				? `Python Script (${Url.basename(details.file)})`
				: `Script (${Url.basename(details.file)})`;

	let terminalPage;
	try {
		terminalPage = await createTerminalPage("temp", projectName);
	} catch (error) {
		console.error("Failed to create terminal page:", error);
		// Continue without terminal page
	}

	// Start the process
	const loaderInstance = loader.create("Starting project...");

	try {
		const fullCommand = `${cdCommand} && ${command}`;
		let processId;
		let localhostUrl = null;

		processId = await executor.start(
			fullCommand,
			(type, data) => {
				loaderInstance.destroy();

				// Display output in terminal page
				if (terminalPage) {
					if (terminalPage.component?.write) {
						// Use terminal component write method
						terminalPage.component.write(`[${type}] ${data}\r\n`);
					} else if (terminalPage.outputElement) {
						// Use simple output element
						const output = terminalPage.outputElement;
						output.textContent += `[${type}] ${data}\n`;
						output.scrollTop = output.scrollHeight;
					}
				}

				// Extract localhost URL from stdout
				if (type === "stdout") {
					const url = extractLocalhostUrl(data);
					if (url && !localhostUrl) {
						localhostUrl = url;

						// Auto-open browser if localhost URL detected
						setTimeout(() => {
							try {
								openBrowser();
							} catch (error) {
								console.error("Failed to auto-open browser:", error);
							}
						}, 1000);
					}
				}

				// Handle process exit
				if (type === "exit") {
					const exitCode = Number.parseInt(data, 10);

					if (exitCode === 0) {
						toast("Process completed successfully");
					} else {
						toast(`Process exited with code ${exitCode}`, "error");
					}
				}
			},
			true,
		); // Use Alpine sandbox

		// Update terminal page with actual process ID
		if (terminalPage && terminalPage.component) {
			terminalPage.component.pid = processId;
		}

		toast(`Project started (PID: ${processId.substring(0, 8)}...)`);

		// If no localhost URL was detected but we have a terminal page, show it
		if (!localhostUrl && terminalPage && terminalPage.file) {
			terminalPage.file.makeActive();
		}

		return true;
	} catch (error) {
		loaderInstance.destroy();
		console.error("Failed to start project:", error);

		alert("Failed to start project", `Error: ${error.message || error}`);

		return false;
	}
}

export default {
	detectExecutableProject,
	runWithExecutor,
};
