import { spawn, spawnSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createProfileEnvironment,
	createWorkspaceId,
	parseUiVerificationProfile,
	resolveProfileLayout,
	seedDebugProfile,
} from "./ui-verification-profile.ts";
import { readHttpJson } from "./ui-verification-http.ts";

const desktopRoot = join(import.meta.dirname, "..");
const repoRoot = realpathSync(join(desktopRoot, "..", ".."));
const workspaceId = createWorkspaceId(repoRoot);
const runtimeRoot = join(tmpdir(), "vetta-ui-verification", workspaceId);
const debugCliPath = join(repoRoot, "apps", "cli-host", "src", "debug-cli.ts");
const currentScriptPath = fileURLToPath(import.meta.url);
const runtimeCanaryProviderPath = join(desktopRoot, "scripts", "runtime-canary-provider.ts");
const runtimeCanaryRunnerPath = join(desktopRoot, "scripts", "runtime-canary-runner.ts");
const childTimeoutMs = 120_000;

function printJson(value) {
	process.stdout.write(`${JSON.stringify(value)}\n`);
}

function resolveLayout(profile, runId) {
	return resolveProfileLayout({ profile, workspaceId, runtimeRoot, runId });
}

function resolveStateLayout(profile, state) {
	return state?.layout ?? resolveLayout(profile);
}

function resolveVerificationEnv(layout, state) {
	const environment = createProfileEnvironment(layout);
	if (!state?.runtimeCanary) return environment;
	return {
		...environment,
		VETTA_CODING_AGENT_DIR: state.runtimeCanary.agentDir,
		VETTA_DESKTOP_RUNTIME_CANARY: "1",
		VETTA_HOME: state.runtimeCanary.vettaHome,
	};
}

function resolveDebugCli(state) {
	if (state?.runtimeCanary) {
		return { command: state.runtimeCanary.installedCliPath, prefixArgs: [] };
	}
	return { command: "bun", prefixArgs: [debugCliPath] };
}

function isProcessAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readState(layout) {
	if (!layout.statePath || !existsSync(layout.statePath)) return null;
	try {
		const state = JSON.parse(readFileSync(layout.statePath, "utf8"));
		if (
			state.workspaceId !== workspaceId ||
			state.profile !== layout.profile ||
			!Number.isInteger(state.hostPid)
		) {
			return null;
		}
		return state;
	} catch {
		return null;
	}
}

function writeState(layout, value) {
	if (!layout.statePath) throw new Error("The development profile does not own host state");
	mkdirSync(dirname(layout.statePath), { recursive: true });
	const temporaryPath = `${layout.statePath}.${process.pid}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temporaryPath, layout.statePath);
}

function updateState(layout, patch) {
	const state = readState(layout);
	if (!state) return;
	writeState(layout, { ...state, ...patch });
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

async function inspectCdp(endpoint) {
	try {
		const targets = await readHttpJson(`${endpoint}/json/list`);
		if (!Array.isArray(targets)) throw new Error("CDP target list was not an array");
		const pages = targets.filter(
			(target) => target?.type === "page" && typeof target.webSocketDebuggerUrl === "string",
		);
		const mainWindow =
			pages.find((target) => target.title === "Vetta Desktop") ??
			pages.find((target) => typeof target.url === "string" && target.url.startsWith("http")) ??
			null;
		return {
			ok: true,
			result: {
				reachable: true,
				targetFound: mainWindow !== null,
				targetCount: pages.length,
				endpoint,
				mainWindow: mainWindow
					? { id: mainWindow.id, title: mainWindow.title, url: mainWindow.url }
					: null,
			},
		};
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "UI_CDP_UNREACHABLE",
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

function readDevUiInfo(layout) {
	const result = spawnSync("bun", [debugCliPath, "debug", "run", "ui.info"], {
		cwd: repoRoot,
		encoding: "utf8",
		env: createProfileEnvironment(layout),
		timeout: 8_000,
		windowsHide: true,
	});
	try {
		return JSON.parse(result.stdout?.trim() ?? "");
	} catch {
		return {
			ok: false,
			error: {
				code: result.error?.code === "ETIMEDOUT" ? "UI_INFO_TIMEOUT" : "UI_INFO_INVALID_OUTPUT",
				message: result.error?.message || result.stderr?.trim() || "ui.info did not return JSON",
			},
		};
	}
}

async function statusResult(profile) {
	const layout = resolveLayout(profile, "status");
	if (profile === "dev") {
		const uiInfo = readDevUiInfo(layout);
		return createStatusResult(layout, null, uiInfo);
	}

	const state = readState(layout);
	if (!state || !isProcessAlive(state.hostPid)) {
		return createStatusResult(layout, state, {
			ok: false,
			error: { code: "UI_HOST_NOT_RUNNING", message: `${profile} UI host is not running` },
		});
	}
	const uiInfo = await inspectCdp(`http://127.0.0.1:${state.cdpPort}`);
	return createStatusResult(resolveStateLayout(profile, state), state, uiInfo);
}

function createStatusResult(layout, state, uiInfo) {
	return {
		ok: uiInfo.ok === true,
		running: uiInfo.ok === true && uiInfo.result?.reachable === true,
		ready: uiInfo.ok === true && uiInfo.result?.targetFound === true,
		profile: layout.profile,
		phase: state?.phase ?? null,
		workspaceId,
		sessionName: layout.sessionName,
		configDir: layout.configDir,
		vettaHome: layout.vettaHome,
		userDataDir: layout.userDataDir,
		artifactDir: layout.artifactDir,
		logPath: layout.logPath,
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

function runPlaywright(layout, args, capture = false, timeout = childTimeoutMs) {
	return spawnSync("bunx", ["playwright-cli", `-s=${layout.sessionName}`, ...args], {
		cwd: repoRoot,
		encoding: capture ? "utf8" : undefined,
		stdio: capture ? "pipe" : "inherit",
		timeout,
		windowsHide: true,
	});
}

function containsSession(value, sessionName) {
	if (value === sessionName) return true;
	if (Array.isArray(value)) return value.some((entry) => containsSession(entry, sessionName));
	if (value && typeof value === "object") {
		return Object.values(value).some((entry) => containsSession(entry, sessionName));
	}
	return false;
}

function ensureAttached(layout, uiInfo) {
	const listResult = spawnSync("bunx", ["playwright-cli", "list", "--json"], {
		cwd: repoRoot,
		encoding: "utf8",
		timeout: 15_000,
		windowsHide: true,
	});
	let listedSession = false;
	try {
		listedSession = containsSession(JSON.parse(listResult.stdout?.trim() ?? ""), layout.sessionName);
	} catch {
		listedSession = false;
	}
	if (listedSession) {
		const probeResult = runPlaywright(layout, ["tab-list"], true, 15_000);
		if (probeResult.status === 0) return false;
		runPlaywright(layout, ["detach"], true, 15_000);
	}

	const attachResult = runPlaywright(layout, ["attach", `--cdp=${uiInfo.endpoint}`]);
	if (attachResult.status !== 0) {
		throw new Error(`Unable to attach Playwright session ${layout.sessionName}`);
	}
	return true;
}

function selectMainWindow(layout, uiInfo) {
	const tabListResult = runPlaywright(layout, ["tab-list"], true, 15_000);
	if (tabListResult.status !== 0) throw new Error("Unable to list Electron renderer tabs");
	const mainWindowUrl = uiInfo.mainWindow?.url;
	const matchingLine = tabListResult.stdout
		.split(/\r?\n/)
		.find((line) => line.includes("[Vetta Desktop](") && (!mainWindowUrl || line.includes(mainWindowUrl)));
	const index = matchingLine?.match(/^- (\d+):/)?.[1];
	if (index === undefined) throw new Error("Unable to find the Vetta Desktop renderer tab");
	const selectResult = runPlaywright(layout, ["tab-select", index]);
	if (selectResult.status !== 0) throw new Error("Unable to select the Vetta Desktop renderer tab");
}

function prepareProfile(layout, sync = false) {
	mkdirSync(layout.runtimeDir, { recursive: true });
	mkdirSync(layout.artifactDir, { recursive: true });
	if (layout.profile !== "debug") return null;
	return seedDebugProfile({
		sourceHome: join(homedir(), ".vetta-dev"),
		targetHome: layout.vettaHome,
		workspacePath: repoRoot,
		sync,
	});
}

async function startDetached(layout, runtimeCanaryEnabled) {
	const existingState = readState(layout);
	if (existingState?.hostPid && isProcessAlive(existingState.hostPid)) {
		throw new Error(
			`${layout.profile} UI verification host is already running with pid ${existingState.hostPid}`,
		);
	}
	if (layout.statePath && existsSync(layout.statePath)) rmSync(layout.statePath, { force: true });
	if (existsSync(layout.endpointFile)) rmSync(layout.endpointFile, { force: true });
	const seed = prepareProfile(layout);
	mkdirSync(dirname(layout.logPath), { recursive: true });
	const logFd = openSync(layout.logPath, "a");
	const child = spawn(
		"bun",
		[
			currentScriptPath,
			"serve",
			"--profile",
			layout.profile,
			...(layout.runId ? ["--run-id", layout.runId] : []),
			...(runtimeCanaryEnabled ? ["--runtime-canary"] : []),
		],
		{
			cwd: repoRoot,
			detached: true,
			stdio: ["ignore", logFd, logFd],
			windowsHide: true,
		},
	);
	closeSync(logFd);
	child.unref();

	const startedAt = Date.now();
	while (Date.now() - startedAt < childTimeoutMs) {
		const state = readState(layout);
		if (state?.hostPid && !isProcessAlive(state.hostPid)) break;
		if (state?.cdpPort) {
			const uiInfo = await inspectCdp(`http://127.0.0.1:${state.cdpPort}`);
			if (uiInfo.ok && uiInfo.result.targetFound) {
				try {
					ensureAttached(layout, uiInfo.result);
					selectMainWindow(layout, uiInfo.result);
					updateState(layout, { phase: "ready", playwrightAttached: true });
				} catch (error) {
					await stopHost(layout, false);
					throw error;
				}
				printJson({
					ok: true,
					status: "ready",
					profile: layout.profile,
					workspaceId,
					sessionName: layout.sessionName,
					vettaHome: layout.vettaHome,
					artifactDir: layout.artifactDir,
					logPath: layout.logPath,
					seed,
					ui: uiInfo.result,
				});
				return;
			}
		}
		await delay(200);
	}
	await stopHost(layout, false);
	throw new Error(`Timed out starting ${layout.profile} UI host. See ${layout.logPath}`);
}

async function startRuntimeCanaryProvider(layout) {
	const fixtureRoot = join(layout.runtimeDir, "runtime-canary", `${Date.now()}-${process.pid}`);
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
			env: createProfileEnvironment(layout),
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
			await delay(50);
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
		delay(5_000).then(() => false),
	]);
	if (stopped) return true;
	if (process.platform === "win32" && child.pid) {
		spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
	} else {
		child.kill("SIGKILL");
	}
	return false;
}

async function serveHost(layout, runtimeCanaryEnabled) {
	const existingState = readState(layout);
	if (existingState?.hostPid && existingState.hostPid !== process.pid && isProcessAlive(existingState.hostPid)) {
		throw new Error(
			`${layout.profile} UI verification host is already running with pid ${existingState.hostPid}`,
		);
	}
	prepareProfile(layout);
	const runtimeCanary = runtimeCanaryEnabled ? await startRuntimeCanaryProvider(layout) : null;
	let activeDesktop;
	let stopping = false;
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.once(signal, () => {
			stopping = true;
			activeDesktop?.child.kill(signal);
		});
	}
	activeDesktop = await startDesktopVerificationProcess(layout, runtimeCanary, 1);

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
			if (stopping) break;
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
			activeDesktop = await startDesktopVerificationProcess(layout, runtimeCanary, restartCount + 1, {
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
		if (layout.statePath && existsSync(layout.statePath)) rmSync(layout.statePath, { force: true });
	}
	process.exitCode = stopping ? 0 : desktopExitCode;
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

async function startDesktopVerificationProcess(layout, runtimeCanary, desktopGeneration, requestedPorts) {
	const rendererPort = requestedPorts?.rendererPort ?? (await findFreePort());
	let cdpPort = requestedPorts?.cdpPort ?? (await findFreePort());
	while (cdpPort === rendererPort) cdpPort = await findFreePort();
	const state = {
		workspaceId,
		profile: layout.profile,
		phase: "starting",
		hostPid: process.pid,
		hostStartedAt: new Date().toISOString(),
		desktopPid: null,
		desktopGeneration,
		rendererPort,
		cdpPort,
		layout,
		...(runtimeCanary ? { runtimeCanary: runtimeCanary.state } : {}),
	};
	writeState(layout, state);
	const child = spawn("bun", ["run", "dev:verify"], {
		cwd: desktopRoot,
		env: {
			...resolveVerificationEnv(layout, state),
			VETTA_DEBUG_CDP_PORT: String(cdpPort),
			VETTA_DESKTOP_DEV_PORT: String(rendererPort),
		},
		stdio: "inherit",
		windowsHide: true,
	});
	if (!child.pid) throw new Error("Desktop verification process did not publish a pid");
	writeState(layout, { ...state, desktopPid: child.pid });
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
	rmSync(runtimeCanary.restartRequestPath, { force: true });
	if (
		!Array.isArray(request?.sessionPaths) ||
		request.sessionPaths.length === 0 ||
		request.sessionPaths.some((sessionPath) => typeof sessionPath !== "string" || sessionPath.length === 0)
	) {
		throw new Error("Runtime Canary restart request must include sessionPaths");
	}
	return { sessionPaths: request.sessionPaths };
}

async function stopHost(layout, printResult = true) {
	const state = readState(layout);
	if (!state?.hostPid || !isProcessAlive(state.hostPid)) {
		if (layout.statePath && existsSync(layout.statePath)) rmSync(layout.statePath, { force: true });
		if (printResult) {
			printJson({ ok: true, stopped: false, reason: "not_running", profile: layout.profile, workspaceId });
		}
		return;
	}
	runPlaywright(resolveStateLayout(layout.profile, state), ["detach"], true, 15_000);
	if (process.platform === "win32") {
		const result = spawnSync("taskkill", ["/PID", String(state.hostPid), "/T", "/F"], {
			encoding: "utf8",
			stdio: "pipe",
			timeout: 15_000,
		});
		if (result.status !== 0 && isProcessAlive(state.hostPid)) {
			throw new Error(
				result.error?.message ||
					result.stderr?.trim() ||
					`Unable to stop UI verification host ${state.hostPid}`,
			);
		}
	} else {
		process.kill(state.hostPid, "SIGTERM");
		const stoppedAt = Date.now();
		while (isProcessAlive(state.hostPid) && Date.now() - stoppedAt < 10_000) await delay(50);
	}
	if (layout.statePath && existsSync(layout.statePath)) rmSync(layout.statePath, { force: true });
	if (printResult) {
		printJson({ ok: true, stopped: true, hostPid: state.hostPid, profile: layout.profile, workspaceId });
	}
}

async function requireUiInfo(profile) {
	const status = await statusResult(profile);
	if (!status.running || !status.ui?.targetFound || !status.ui.endpoint) {
		printJson(status);
		process.exitCode = 1;
		return null;
	}
	return { layout: resolveStateLayout(profile, readState(resolveLayout(profile, "status"))), ui: status.ui };
}

function parseArguments(argv) {
	const [command, ...rawArgs] = argv;
	let profileValue;
	let runId;
	let runtimeCanaryEnabled = false;
	const args = [];
	for (let index = 0; index < rawArgs.length; index += 1) {
		const argument = rawArgs[index];
		if (argument === "--profile") {
			profileValue = rawArgs[index + 1];
			index += 1;
			continue;
		}
		if (argument === "--run-id") {
			runId = rawArgs[index + 1];
			index += 1;
			continue;
		}
		if (argument === "--runtime-canary") {
			runtimeCanaryEnabled = true;
			continue;
		}
		if (argument === "--") continue;
		args.push(argument);
	}
	return {
		command,
		profile: parseUiVerificationProfile(profileValue),
		runId,
		runtimeCanaryEnabled,
		args,
	};
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const parsed = parseArguments(process.argv.slice(2));
const layout = resolveLayout(parsed.profile, parsed.runId);

if (parsed.command === "start") {
	if (parsed.profile === "dev") throw new Error("The dev profile is attach-only and cannot be started here");
	await startDetached(layout, parsed.runtimeCanaryEnabled);
} else if (parsed.command === "serve") {
	if (parsed.profile === "dev") throw new Error("The dev profile is attach-only and cannot be served here");
	await serveHost(layout, parsed.runtimeCanaryEnabled);
} else if (parsed.command === "status") {
	const status = await statusResult(parsed.profile);
	printJson(status);
	if (!status.running) process.exitCode = 1;
} else if (parsed.command === "stop") {
	if (parsed.profile === "dev") throw new Error("The dev profile is not owned by UI verification; stop it from its development terminal");
	await stopHost(layout);
} else if (parsed.command === "sync") {
	if (parsed.profile !== "debug") throw new Error("Only the debug profile supports data synchronization");
	const state = readState(layout);
	if (state?.hostPid && isProcessAlive(state.hostPid)) {
		throw new Error("Stop the debug profile before synchronizing model configuration");
	}
	printJson({ ok: true, profile: parsed.profile, ...prepareProfile(layout, true) });
} else if (parsed.command === "attach") {
	const target = await requireUiInfo(parsed.profile);
	if (target) {
		ensureAttached(target.layout, target.ui);
		selectMainWindow(target.layout, target.ui);
		const result = runPlaywright(target.layout, ["tab-list"]);
		process.exitCode = result.status ?? 1;
	}
} else if (parsed.command === "pw") {
	if (parsed.args.length === 0) throw new Error("Missing Playwright CLI command");
	const target = await requireUiInfo(parsed.profile);
	if (target) {
		if (ensureAttached(target.layout, target.ui)) selectMainWindow(target.layout, target.ui);
		const result = runPlaywright(target.layout, parsed.args);
		process.exitCode = result.status ?? 1;
	}
} else if (parsed.command === "detach") {
	const result = runPlaywright(layout, ["detach"]);
	process.exitCode = result.status ?? 1;
} else if (parsed.command === "debug") {
	const state = readState(layout);
	const runtimeCanaryRequested = parsed.args.length === 1 && parsed.args[0] === "runtime-canary";
	if (runtimeCanaryRequested && !state?.runtimeCanary) {
		throw new Error("The UI verification host was not started in Runtime Canary mode");
	}
	const stateLayout = resolveStateLayout(parsed.profile, state);
	const result = runtimeCanaryRequested
		? spawnSync("bun", [runtimeCanaryRunnerPath, "--state-file", stateLayout.statePath], {
				cwd: repoRoot,
				env: resolveVerificationEnv(stateLayout, state),
				stdio: "inherit",
				timeout: childTimeoutMs,
			})
		: (() => {
				const cli = resolveDebugCli(state);
				return spawnSync(cli.command, [...cli.prefixArgs, "debug", ...parsed.args], {
					cwd: repoRoot,
					env: resolveVerificationEnv(stateLayout, state),
					stdio: "inherit",
					timeout: childTimeoutMs,
				});
			})();
	process.exitCode = result.status ?? 1;
} else {
	throw new Error(`Unknown command: ${parsed.command ?? "<missing>"}`);
}
