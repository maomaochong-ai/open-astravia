import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";

const projectRoot = join(import.meta.dirname, "..");

function resolveRendererPort() {
	const rawPort = process.env.ASTRAVIA_DESKTOP_DEV_PORT ?? "3020";
	const port = Number(rawPort);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`Invalid ASTRAVIA_DESKTOP_DEV_PORT: ${rawPort}`);
	}
	return port;
}

function waitForExit(child) {
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});
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

	const electronArgs = [];
	if (process.env.ASTRAVIA_UI_VERIFICATION === "1") {
		const configDir = process.env.ASTRAVIA_CONFIG_DIR ?? ".astravia-ui-verify";
		electronArgs.push(`--user-data-dir=${join(homedir(), configDir, "electron-user-data")}`);
	}
	electronArgs.push(join(projectRoot, "dist", "main", "index.js"));

	const electronProcess = spawn(electronPath, electronArgs, {
		cwd: projectRoot,
		env: {
			...process.env,
			// dev 模式用独立配置目录 .astravia-dev，避免和正式发布版 ~/.astravia 混用
			// （dev 配的 apiKey / models.json 不应污染正式版）
			ASTRAVIA_CONFIG_DIR: process.env.ASTRAVIA_CONFIG_DIR ?? ".astravia-dev",
			ASTRAVIA_DESKTOP_DEV_URL: rendererUrl,
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

await main();
