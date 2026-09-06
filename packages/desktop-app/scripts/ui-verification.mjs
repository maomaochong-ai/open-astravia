import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const desktopRoot = join(import.meta.dirname, "..");
const repoRoot = join(desktopRoot, "..", "..");
const workspaceId = createHash("sha256").update(realpathSync(repoRoot)).digest("hex").slice(0, 8);
const sessionName = `astravia-${workspaceId}`;
const configDir = `.astravia-ui-verify-${workspaceId}`;
const runtimeDir = join(tmpdir(), "astravia-ui-verification", workspaceId);
const statePath = join(runtimeDir, "host.json");
const artifactDir = join(runtimeDir, "artifacts");
const cliPath = join(repoRoot, "packages", "cli-app", "src", "cli.ts");

const verificationEnv = {
	...process.env,
	// 覆盖外层可能继承的 ASTRAVIA_HOME（如指向正式版 ~/.astravia），
	// 确保 dev 壳主进程 / CLI agent 读写独立目录，与正式版数据完全隔离。
	ASTRAVIA_HOME: join(homedir(), configDir),
	ASTRAVIA_CONFIG_DIR: configDir,
	ASTRAVIA_THEME_DEV_SERVER: "0",
	ASTRAVIA_UI_VERIFICATION: "1",
};

function printJson(value) {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

function readUiInfo() {
	const result = spawnSync("bun", [cliPath, "debug", "run", "ui.info"], {
		cwd: repoRoot,
		encoding: "utf8",
		env: verificationEnv,
	});
	try {
		return JSON.parse(result.stdout.trim());
	} catch {
		return {
			ok: false,
			error: {
				code: "UI_INFO_INVALID_OUTPUT",
				message: result.stderr.trim() || "ui.info did not return JSON",
			},
		};
	}
}

function isProcessAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readState() {
	if (!existsSync(statePath)) return null;
	try {
		const state = JSON.parse(readFileSync(statePath, "utf8"));
		if (state.workspaceId !== workspaceId || !Number.isInteger(state.hostPid)) return null;
		return state;
	} catch {
		return null;
	}
}

async function findFreePort() {
	return await new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (typeof address === "string" || address === null) {
				server.close(() => reject(new Error("Unable to allocate a TCP port")));
				return;
			}
			server.close((error) => (error ? reject(error) : resolve(address.port)));
		});
	});
}

function statusResult() {
	const state = readState();
	const uiInfo = readUiInfo();
	return {
		ok: uiInfo.ok === true,
		running: uiInfo.ok === true && uiInfo.result?.reachable === true,
		workspaceId,
		sessionName,
		configDir,
		artifactDir,
		hostPid: state?.hostPid ?? null,
		ui: uiInfo.ok === true ? uiInfo.result : null,
		error: uiInfo.ok === true ? null : uiInfo.error,
	};
}

function runPlaywright(args, capture = false) {
	return spawnSync("bunx", ["playwright-cli", `-s=${sessionName}`, ...args], {
		cwd: repoRoot,
		encoding: capture ? "utf8" : undefined,
		stdio: capture ? "pipe" : "inherit",
	});
}

function containsSession(value) {
	if (value === sessionName) return true;
	if (Array.isArray(value)) return value.some(containsSession);
	if (value && typeof value === "object") return Object.values(value).some(containsSession);
	return false;
}

function ensureAttached(uiInfo) {
	const listResult = spawnSync("bunx", ["playwright-cli", "list", "--json"], {
		cwd: repoRoot,
		encoding: "utf8",
	});
	let listedSession = false;
	try {
		listedSession = containsSession(JSON.parse(listResult.stdout.trim()));
	} catch {
		listedSession = false;
	}
	if (listedSession) return false;

	const attachResult = runPlaywright(["attach", `--cdp=${uiInfo.endpoint}`]);
	if (attachResult.status !== 0) {
		throw new Error(`Unable to attach Playwright session ${sessionName}`);
	}
	return true;
}

function selectMainWindow(uiInfo) {
	const tabListResult = runPlaywright(["tab-list"], true);
	if (tabListResult.status !== 0) throw new Error("Unable to list Electron renderer tabs");
	const mainWindowUrl = uiInfo.mainWindow?.url;
	const matchingLine = tabListResult.stdout
		.split(/\r?\n/)
		.find((line) => line.includes("[Astravia Desktop](") && (!mainWindowUrl || line.includes(mainWindowUrl)));
	const index = matchingLine?.match(/^- (\d+):/)?.[1];
	if (index === undefined) throw new Error("Unable to find the Astravia Desktop renderer tab");
	const selectResult = runPlaywright(["tab-select", index]);
	if (selectResult.status !== 0) throw new Error("Unable to select the Astravia Desktop renderer tab");
}

async function startHost() {
	const existingState = readState();
	if (existingState?.hostPid && isProcessAlive(existingState.hostPid)) {
		throw new Error(`UI verification host is already running with pid ${existingState.hostPid}`);
	}

	const rendererPort = await findFreePort();
	let cdpPort = await findFreePort();
	while (cdpPort === rendererPort) cdpPort = await findFreePort();
	mkdirSync(artifactDir, { recursive: true });
	writeFileSync(
		statePath,
		JSON.stringify({ workspaceId, hostPid: process.pid, rendererPort, cdpPort }, null, 2),
	);
	printJson({
		ok: true,
		status: "starting",
		workspaceId,
		sessionName,
		configDir,
		artifactDir,
		rendererUrl: `http://127.0.0.1:${rendererPort}`,
		cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
	});

	const child = spawn("bun", ["run", "dev:verify"], {
		cwd: desktopRoot,
		env: {
			...verificationEnv,
			ASTRAVIA_DEBUG_CDP_PORT: String(cdpPort),
			ASTRAVIA_DESKTOP_DEV_PORT: String(rendererPort),
		},
		stdio: "inherit",
	});
	const cleanup = () => {
		if (existsSync(statePath)) rmSync(statePath);
	};
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.once(signal, () => child.kill(signal));
	}
	try {
		process.exitCode = await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code) => resolve(code ?? 1));
		});
	} finally {
		cleanup();
	}
}

function stopHost() {
	const state = readState();
	if (!state?.hostPid || !isProcessAlive(state.hostPid)) {
		if (existsSync(statePath)) rmSync(statePath);
		printJson({ ok: true, stopped: false, reason: "not_running", workspaceId });
		return;
	}
	if (process.platform === "win32") {
		const result = spawnSync("taskkill", ["/PID", String(state.hostPid), "/T", "/F"], {
			stdio: "inherit",
		});
		if (result.status !== 0) throw new Error(`Unable to stop UI verification host ${state.hostPid}`);
	} else {
		process.kill(state.hostPid, "SIGTERM");
	}
	if (existsSync(statePath)) rmSync(statePath);
	printJson({ ok: true, stopped: true, hostPid: state.hostPid, workspaceId });
}

function requireUiInfo() {
	const status = statusResult();
	if (!status.running || !status.ui?.targetFound || !status.ui.endpoint) {
		printJson(status);
		process.exitCode = 1;
		return null;
	}
	return status.ui;
}

const [command, ...args] = process.argv.slice(2);
if (command === "start") {
	await startHost();
} else if (command === "status") {
	const status = statusResult();
	printJson(status);
	if (!status.running) process.exitCode = 1;
} else if (command === "stop") {
	stopHost();
} else if (command === "attach") {
	const uiInfo = requireUiInfo();
	if (uiInfo) {
		ensureAttached(uiInfo);
		selectMainWindow(uiInfo);
		const result = runPlaywright(["tab-list"]);
		process.exitCode = result.status ?? 1;
	}
} else if (command === "pw") {
	if (args.length === 0) throw new Error("Missing Playwright CLI command");
	const uiInfo = requireUiInfo();
	if (uiInfo) {
		if (ensureAttached(uiInfo)) selectMainWindow(uiInfo);
		const result = runPlaywright(args);
		process.exitCode = result.status ?? 1;
	}
} else if (command === "detach") {
	const result = runPlaywright(["detach"]);
	process.exitCode = result.status ?? 1;
} else if (command === "debug") {
	const result = spawnSync("bun", [cliPath, "debug", ...args], {
		cwd: repoRoot,
		env: verificationEnv,
		stdio: "inherit",
	});
	process.exitCode = result.status ?? 1;
} else {
	throw new Error(`Unknown command: ${command ?? "<missing>"}`);
}
