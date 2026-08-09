import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electronPath from "electron";

const projectRoot = join(import.meta.dirname, "..");

function resolveRendererPort() {
	const rawPort = process.env.VETTA_DESKTOP_DEV_PORT ?? "3020";
	const port = Number(rawPort);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`Invalid VETTA_DESKTOP_DEV_PORT: ${rawPort}`);
	}
	return port;
}

function waitForExit(child) {
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});
}

export function resolveDevLaunchEnvironment(environment = process.env, homeDirectory = homedir()) {
	const verificationEnabled = environment.VETTA_UI_VERIFICATION === "1";
	const configDir =
		environment.VETTA_CONFIG_DIR?.trim() || (verificationEnabled ? ".vetta-ui-verify" : ".vetta-dev");
	const configuredUserDataDir = environment.VETTA_DESKTOP_USER_DATA_DIR?.trim();
	const userDataDir = configuredUserDataDir
		? resolve(configuredUserDataDir)
		: join(homeDirectory, configDir, "electron-user-data");
	return { configDir, userDataDir };
}

async function main() {
	const rendererPort = resolveRendererPort();
	const rendererUrl = `http://127.0.0.1:${rendererPort}`;
	const waitProcess = spawn("bunx", ["wait-on", `tcp:127.0.0.1:${rendererPort}`], {
		cwd: projectRoot,
		stdio: "inherit",
	});
	const waitResult = await waitForExit(waitProcess);
	if (waitResult.signal || waitResult.code !== 0) {
		process.exitCode = waitResult.code ?? 1;
		return;
	}

	const { configDir, userDataDir } = resolveDevLaunchEnvironment();
	const electronArgs = [];
	if (process.env.VETTA_UI_VERIFICATION === "1") {
		if (process.env.VETTA_DESKTOP_RUNTIME_CANARY === "1") {
			electronArgs.push("--disable-gpu");
			electronArgs.push("--no-sandbox");
		}
	}
	electronArgs.push(`--user-data-dir=${userDataDir}`);
	electronArgs.push(join(projectRoot, "dist", "main", "index.js"));

	const electronProcess = spawn(electronPath, electronArgs, {
		cwd: projectRoot,
		env: {
			...process.env,
			VETTA_CONFIG_DIR: configDir,
			VETTA_DESKTOP_DEV_URL: rendererUrl,
		},
		stdio: "inherit",
	});
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.once(signal, () => electronProcess.kill(signal));
	}
	const electronResult = await waitForExit(electronProcess);
	if (electronResult.signal) {
		process.exitCode = 1;
		return;
	}
	process.exitCode = electronResult.code ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
