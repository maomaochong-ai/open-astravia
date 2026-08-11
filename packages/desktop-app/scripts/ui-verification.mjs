import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const desktopRoot = join(import.meta.dirname, "..");
const repoRoot = join(desktopRoot, "..", "..");
const workspaceId = createHash("sha256").update(realpathSync(repoRoot)).digest("hex").slice(0, 8);
const sessionName = `vetta-${workspaceId}`;
const configDir = `.vetta-ui-verify-${workspaceId}`;
const runtimeDir = join(tmpdir(), "vetta-ui-verification", workspaceId);
const statePath = join(runtimeDir, "host.json");
const artifactDir = join(runtimeDir, "artifacts");
const cliPath = join(repoRoot, "packages", "cli-app", "src", "cli.ts");
const runtimeCanaryProviderPath = join(desktopRoot, "scripts", "runtime-canary-provider.ts");
const runtimeCanaryRunnerPath = join(desktopRoot, "scripts", "runtime-canary-runner.ts");
const baseVerificationEnv = {
	...process.env,
	VETTA_CONFIG_DIR: configDir,
	VETTA_DESKTOP_USER_DATA_DIR: join(runtimeDir, "electron-user-data"),
	VETTA_THEME_DEV_SERVER: "0",
	VETTA_UI_VERIFICATION: "1",
};

function printJson(value) {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

function resolveVerificationEnv(state = readState()) {
	const runtimeCanary = state?.runtimeCanary;
	if (!runtimeCanary) return baseVerificationEnv;
	const env = {
		...baseVerificationEnv,
		VETTA_CODING_AGENT_DIR: runtimeCanary.agentDir,
		VETTA_DESKTOP_RUNTIME_CANARY: "1",
		VETTA_HOME: runtimeCanary.vettaHome,
	};
	return env;
}

function resolveDebugCli(state) {
	if (state?.runtimeCanary) {
		return { command: state.runtimeCanary.installedCliPath, prefixArgs: [] };
	}
	return { command: "bun", prefixArgs: [cliPath] };
}

function readUiInfo(state = readState()) {
	const cli = resolveDebugCli(state);
	const result = spawnSync(cli.command, [...cli.prefixArgs, "debug", "run", "ui.info"], {
		cwd: repoRoot,
		encoding: "utf8",
		env: resolveVerificationEnv(state),
	});
	try {
		return JSON.parse(result.stdout?.trim() ?? "");
	} catch {
		return {
			ok: false,
			error: {
				code: "UI_INFO_INVALID_OUTPUT",
				message: result.error?.message || result.stderr?.trim() || "ui.info did not return JSON",
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
	const uiInfo = readUiInfo(state);
	return {
		ok: uiInfo.ok === true,
		running: uiInfo.ok === true && uiInfo.result?.reachable === true,
		workspaceId,
		sessionName,
		configDir,
		artifactDir,
		hostPid: state?.hostPid ?? null,
		desktopPid: state?.desktopPid ?? null,
		desktopGeneration: state?.desktopGeneration ?? null,
		runtimeCanary: state?.runtimeCanary
			? {
					workspace: state.runtimeCanary.workspace,
					providerPid: state.runtimeCanary.providerPid,
					installedCliPath: state.runtimeCanary.installedCliPath,
				}
			: null,
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
		.find((line) => line.includes("[Vetta Desktop](") && (!mainWindowUrl || line.includes(mainWindowUrl)));
	const index = matchingLine?.match(/^- (\d+):/)?.[1];
	if (index === undefined) throw new Error("Unable to find the Vetta Desktop renderer tab");
	const selectResult = runPlaywright(["tab-select", index]);
	if (selectResult.status !== 0) throw new Error("Unable to select the Vetta Desktop renderer tab");
}

async function startRuntimeCanaryProvider() {
	const fixtureRoot = join(runtimeDir, "runtime-canary", `${Date.now()}-${process.pid}`);
	const readyFilePath = join(fixtureRoot, "provider-ready.json");
	const exitReportPath = join(fixtureRoot, "host-exit.json");
	const restartRequestPath = join(fixtureRoot, "restart-request.json");
	const restartReportPath = join(fixtureRoot, "restart-report.json");
	mkdirSync(fixtureRoot, { recursive: true });
	const child = spawn(
		"bun",
		[runtimeCanaryProviderPath, "--root", fixtureRoot, "--ready-file", readyFilePath],
		{
			cwd: repoRoot,
			env: baseVerificationEnv,
			stdio: "inherit",
			windowsHide: true,
		},
	);
	let spawnError;
	child.once("error", (error) => {
		spawnError = error;
	});
	try {
		const startedAt = Date.now();
		while (!existsSync(readyFilePath)) {
			if (spawnError) throw spawnError;
			if (child.exitCode !== null || child.signalCode !== null) {
				throw new Error("Runtime Canary Provider exited before publishing its fixture");
			}
			if (Date.now() - startedAt >= 10_000) {
				throw new Error("Timed out waiting for Runtime Canary Provider");
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		const fixture = JSON.parse(readFileSync(readyFilePath, "utf8"));
		if (
			typeof fixture?.vettaHome !== "string" ||
			typeof fixture.agentDir !== "string" ||
			typeof fixture.workspace !== "string" ||
			typeof fixture.requestLogPath !== "string" ||
			typeof fixture.installedCliPath !== "string" ||
			typeof fixture.modelKey !== "string" ||
			typeof fixture.knowledgeRoot !== "string" ||
			typeof fixture.knowledgeSourceHash !== "string" ||
			!child.pid
		) {
			throw new Error("Runtime Canary Provider published an invalid fixture");
		}
		return {
			child,
			state: {
				...fixture,
				providerPid: child.pid,
				exitReportPath,
				restartRequestPath,
				restartReportPath,
			},
		};
	} catch (error) {
		await stopRuntimeCanaryProvider(child);
		throw error;
	}
}

async function stopRuntimeCanaryProvider(child) {
	if (child.exitCode !== null || child.signalCode !== null) return true;
	child.kill("SIGTERM");
	const stopped = await Promise.race([
		new Promise((resolve) => child.once("exit", () => resolve(true))),
		new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
	]);
	if (stopped) return true;
	if (process.platform === "win32" && child.pid) {
		spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
	} else {
		child.kill("SIGKILL");
	}
	return false;
}

function parseRuntimeCanaryEnabled(args) {
	if (args.length === 0) return null;
	if (args.length === 1 && args[0] === "--runtime-canary") return true;
	throw new Error('Expected "--runtime-canary"');
}

async function startHost(runtimeCanaryEnabled) {
	const existingState = readState();
	if (existingState?.hostPid && isProcessAlive(existingState.hostPid)) {
		throw new Error(`UI verification host is already running with pid ${existingState.hostPid}`);
	}

	mkdirSync(artifactDir, { recursive: true });
	const runtimeCanary = runtimeCanaryEnabled ? await startRuntimeCanaryProvider() : null;
	let activeDesktop;
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.once(signal, () => activeDesktop?.child.kill(signal));
	}
	activeDesktop = await startDesktopVerificationProcess(runtimeCanary, 1);
	printJson({
		ok: true,
		status: "starting",
		workspaceId,
		sessionName,
		configDir,
		artifactDir,
		runtimeCanary: runtimeCanary
			? {
					workspace: runtimeCanary.state.workspace,
					providerPid: runtimeCanary.state.providerPid,
				}
			: null,
		rendererUrl: `http://127.0.0.1:${activeDesktop.rendererPort}`,
		cdpEndpoint: `http://127.0.0.1:${activeDesktop.cdpPort}`,
	});

	let desktopExitCode = 1;
	const desktopExitCodes = [];
	const desktopProcessIds = [];
	let restartCount = 0;
	let providerStopped = runtimeCanary === null;
	try {
		while (activeDesktop) {
			desktopExitCode = await waitForChildExit(activeDesktop.child);
			desktopExitCodes.push(desktopExitCode);
			desktopProcessIds.push(activeDesktop.child.pid);
			const restartRequest = runtimeCanary ? readRuntimeCanaryRestartRequest(runtimeCanary.state) : null;
			if (!restartRequest) break;

			const endpointRemoved = !existsSync(join(runtimeCanary.state.vettaHome, "action-server.json"));
			const sessionLocksReleased = restartRequest.sessionPaths.every(
				(sessionPath) => !existsSync(`${sessionPath}.lock`) && !existsSync(`${sessionPath}.owner.lock`),
			);
			const knowledgeRawsUnlocked = areKnowledgeRawsUnlocked(runtimeCanary.state.knowledgeRoot);
			writeFileSync(
				runtimeCanary.state.restartReportPath,
				JSON.stringify(
					{
						desktopExitCode,
						desktopPid: activeDesktop.child.pid,
						endpointRemoved,
						sessionLocksReleased,
						knowledgeRawsUnlocked,
					},
					null,
					2,
				),
			);
			if (desktopExitCode !== 0 || !endpointRemoved || !sessionLocksReleased || !knowledgeRawsUnlocked) {
				desktopExitCode = 1;
				break;
			}
			restartCount += 1;
			activeDesktop = await startDesktopVerificationProcess(runtimeCanary, restartCount + 1, {
				rendererPort: activeDesktop.rendererPort,
				cdpPort: activeDesktop.cdpPort,
			});
		}
	} finally {
		if (runtimeCanary) {
			providerStopped = await stopRuntimeCanaryProvider(runtimeCanary.child);
			writeFileSync(
				runtimeCanary.state.exitReportPath,
				JSON.stringify(
					{
						desktopExitCode,
						desktopExitCodes,
						desktopProcessIds,
						restartCount,
						endpointRemoved: !existsSync(join(runtimeCanary.state.vettaHome, "action-server.json")),
						providerStopped,
					},
					null,
					2,
				),
			);
		}
		if (existsSync(statePath)) rmSync(statePath);
	}
	process.exitCode = desktopExitCode;
}

function areKnowledgeRawsUnlocked(knowledgeRoot) {
	if (process.platform === "win32") return true;
	const rawsDirectory = join(knowledgeRoot, "raws");
	if (!existsSync(rawsDirectory)) return false;
	const pending = [rawsDirectory];
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) continue;
		const currentStat = statSync(current);
		if ((currentStat.mode & 0o200) === 0) return false;
		if (!currentStat.isDirectory()) continue;
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			pending.push(join(current, entry.name));
		}
	}
	return true;
}

async function startDesktopVerificationProcess(runtimeCanary, desktopGeneration, requestedPorts) {
	const rendererPort = requestedPorts?.rendererPort ?? (await findFreePort());
	let cdpPort = requestedPorts?.cdpPort ?? (await findFreePort());
	while (cdpPort === rendererPort) cdpPort = await findFreePort();
	const child = spawn("bun", ["run", "dev:verify"], {
		cwd: desktopRoot,
		env: {
			...resolveVerificationEnv({
				...(runtimeCanary ? { runtimeCanary: runtimeCanary.state } : {}),
			}),
			VETTA_DEBUG_CDP_PORT: String(cdpPort),
			VETTA_DESKTOP_DEV_PORT: String(rendererPort),
		},
		stdio: "inherit",
	});
	if (!child.pid) throw new Error("Desktop verification process did not publish a pid");
	writeFileSync(
		statePath,
		JSON.stringify(
			{
				workspaceId,
				hostPid: process.pid,
				desktopPid: child.pid,
				desktopGeneration,
				rendererPort,
				cdpPort,
				...(runtimeCanary ? { runtimeCanary: runtimeCanary.state } : {}),
			},
			null,
			2,
		),
	);
	return { child, rendererPort, cdpPort };
}

function waitForChildExit(child) {
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
	});
}

function readRuntimeCanaryRestartRequest(runtimeCanary) {
	if (!existsSync(runtimeCanary.restartRequestPath)) return null;
	const request = JSON.parse(readFileSync(runtimeCanary.restartRequestPath, "utf8"));
	rmSync(runtimeCanary.restartRequestPath);
	if (
		!Array.isArray(request?.sessionPaths) ||
		request.sessionPaths.length === 0 ||
		request.sessionPaths.some((sessionPath) => typeof sessionPath !== "string" || sessionPath.length === 0)
	) {
		throw new Error("Runtime Canary restart request must include sessionPaths");
	}
	return { sessionPaths: request.sessionPaths };
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
	await startHost(parseRuntimeCanaryEnabled(args));
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
	const state = readState();
	const runtimeCanaryRequested = args.length === 1 && args[0] === "runtime-canary";
	if (runtimeCanaryRequested && !state?.runtimeCanary) {
		throw new Error("The UI verification host was not started in Runtime Canary mode");
	}
	const result = runtimeCanaryRequested
		? spawnSync("bun", [runtimeCanaryRunnerPath, "--state-file", statePath], {
				cwd: repoRoot,
				env: resolveVerificationEnv(state),
				stdio: "inherit",
			})
		: (() => {
				const cli = resolveDebugCli(state);
				return spawnSync(cli.command, [...cli.prefixArgs, "debug", ...args], {
					cwd: repoRoot,
					env: resolveVerificationEnv(state),
					stdio: "inherit",
				});
			})();
	process.exitCode = result.status ?? 1;
} else {
	throw new Error(`Unknown command: ${command ?? "<missing>"}`);
}
