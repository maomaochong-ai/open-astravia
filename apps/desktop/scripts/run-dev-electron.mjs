import { spawn } from "node:child_process";
import { Socket } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import electronPath from "electron";
import { resolveSystemPluginSelection } from "./stage-system-plugins.mjs";

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

export async function waitForRendererPort(
	port,
	{ timeoutMs = 120_000, retryIntervalMs = 100 } = {},
) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (await canConnect(port)) return;
		await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
	}
	throw new Error(`Timed out after ${timeoutMs}ms waiting for renderer port 127.0.0.1:${port}`);
}

function canConnect(port) {
	return new Promise((resolve) => {
		const socket = new Socket();
		const finish = (connected) => {
			socket.removeAllListeners();
			socket.destroy();
			resolve(connected);
		};
		socket.setTimeout(1_000);
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
		socket.once("timeout", () => finish(false));
		socket.connect(port, "127.0.0.1");
	});
}

function resolveConfigRoot(configDirOrPath, homeDirectory) {
	if (configDirOrPath === "~") return homeDirectory;
	if (configDirOrPath.startsWith("~/")) return join(homeDirectory, configDirOrPath.slice(2));
	return isAbsolute(configDirOrPath) ? configDirOrPath : join(homeDirectory, configDirOrPath);
}

export function resolveDevLaunchEnvironment(environment = process.env, homeDirectory = homedir()) {
	const verificationEnabled = environment.ASTRAVIA_UI_VERIFICATION === "1";
	const configDir =
		environment.ASTRAVIA_CONFIG_DIR?.trim() || (verificationEnabled ? ".astravia-ui-verify" : ".astravia-dev");
	// 继承来的 ASTRAVIA_CONFIG_DIR 可能是绝对路径（宿主导出的就是），直接 join 会拼出
	// ~/Users/<name>/... 这种重复前缀的目录。
	const configRoot = resolveConfigRoot(configDir, homeDirectory);
	const configuredUserDataDir = environment.ASTRAVIA_DESKTOP_USER_DATA_DIR?.trim();
	const userDataDir = configuredUserDataDir ? resolve(configuredUserDataDir) : join(configRoot, "electron-user-data");
	// 数据根必须钉在这套配置目录下：getAstraviaHomePath() 里 ASTRAVIA_HOME 优先于
	// ASTRAVIA_CONFIG_DIR，而父进程（已安装的桌面应用、agent shell）会把它导出给子进程。
	// 只设 ASTRAVIA_CONFIG_DIR 的话，dev 实例的实际数据根仍是宿主的 ~/.astravia，
	// 于是两边共用同一份 sessions/插件/action 端点，宿主会被连带重载。
	const configuredHomeDir = environment.ASTRAVIA_DEV_HOME?.trim();
	const homePath = configuredHomeDir ? resolveConfigRoot(configuredHomeDir, homeDirectory) : configRoot;
	return { configDir, userDataDir, homePath };
}

export function resolveDevPluginIds(
	environment = process.env,
	tenantResolver = resolveSystemPluginSelection,
) {
	if (Object.hasOwn(environment, "ASTRAVIA_PLUGIN_DEV")) {
		return environment.ASTRAVIA_PLUGIN_DEV ?? "";
	}
	const tenant = tenantResolver(environment.ASTRAVIA_TENANT, "development");
	return tenant.pluginIds ? Array.from(tenant.pluginIds).sort().join(",") : "";
}

export function resolveDevProcessEnvironment(environment = process.env) {
	return {
		...environment,
		// Keep local action/plugin iteration frictionless without weakening packaged builds.
		// Set to "0" when manually testing the approval flow in development.
		ASTRAVIA_DEV_AUTO_APPROVE_ACTIONS: environment.ASTRAVIA_DEV_AUTO_APPROVE_ACTIONS ?? "1",
	};
}

async function main() {
	const rendererPort = resolveRendererPort();
	const rendererUrl = `http://127.0.0.1:${rendererPort}`;
	await waitForRendererPort(rendererPort);

	const { configDir, homePath, userDataDir } = resolveDevLaunchEnvironment();
	const pluginIds = resolveDevPluginIds();
	const electronArgs = [];
	if (process.env.ASTRAVIA_UI_VERIFICATION === "1") {
		if (process.env.ASTRAVIA_DESKTOP_RUNTIME_CANARY === "1") {
			electronArgs.push("--disable-gpu");
			electronArgs.push("--no-sandbox");
		}
	}
	electronArgs.push(`--user-data-dir=${userDataDir}`);
	electronArgs.push(join(projectRoot, "dist", "main", "index.js"));

	console.log(`[dev] data home: ${homePath}`);
	const electronProcess = spawn(electronPath, electronArgs, {
		cwd: projectRoot,
		env: {
			...resolveDevProcessEnvironment(),
			ASTRAVIA_CONFIG_DIR: configDir,
			// 显式钉住数据根，不让宿主导出的 ASTRAVIA_HOME 透进来。
			ASTRAVIA_HOME: homePath,
			ASTRAVIA_DESKTOP_DEV_URL: rendererUrl,
			ASTRAVIA_PLUGIN_DEV: pluginIds,
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
