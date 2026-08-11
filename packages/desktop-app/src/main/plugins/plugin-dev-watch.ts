import { type ChildProcess, spawn } from "node:child_process";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { getAppLogger } from "../logger.js";
import { pluginDevLinkService, type SetPluginDevLinkOptions } from "./plugin-catalog.js";
import { resolvePluginDevCliPath } from "./plugin-dev-cli.js";
import { type PluginDevServerEvent, parsePluginDevServerOutput } from "./plugin-dev-protocol.js";
import { refreshAgentPlugins } from "./plugin-runtime-service.js";

const log = getAppLogger("plugin");
const DEBOUNCE_MS = 80;
const KILL_GRACE_MS = 3000;
const STARTUP_TIMEOUT_MS = 15_000;
const RESTART_DELAYS_MS = [250, 1000, 3000] as const;

interface DevWatchEntry {
	projectDir: string;
	child: ChildProcess | null;
	debounceTimer: NodeJS.Timeout | null;
	startupTimer: NodeJS.Timeout | null;
	restartTimer: NodeJS.Timeout | null;
	resolveReady: ((plugin: InstalledPlugin) => void) | null;
	rejectReady: ((error: Error) => void) | null;
	stopped: boolean;
	ready: boolean;
	attempt: number;
	restartAttempts: number;
}

const entries = new Map<string, DevWatchEntry>();

function settleInitialStartup(entry: DevWatchEntry, result: InstalledPlugin | Error): void {
	if (entry.startupTimer) clearTimeout(entry.startupTimer);
	entry.startupTimer = null;
	if (result instanceof Error) entry.rejectReady?.(result);
	else entry.resolveReady?.(result);
	entry.resolveReady = null;
	entry.rejectReady = null;
}

function scheduleRefresh(id: string, entry: DevWatchEntry): void {
	if (entry.stopped || !entry.ready) return;
	if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
	entry.debounceTimer = setTimeout(() => {
		entry.debounceTimer = null;
		if (entry.stopped || !entry.ready) return;
		try {
			pluginDevLinkService.refresh(id);
			refreshAgentPlugins();
			log.info(`dev-watch: refreshed ${id}`);
		} catch (error) {
			log.warn(`dev-watch: reload failed for ${id}`, error);
			pluginDevLinkService.setStatus(id, "error", error instanceof Error ? error.message : String(error));
		}
	}, DEBOUNCE_MS);
}

function stopChild(child: ChildProcess | null): void {
	if (!child || child.killed) return;
	try {
		child.kill();
	} catch {
		return;
	}
	const killTimer = setTimeout(() => {
		try {
			child.kill("SIGKILL");
		} catch {
			// already gone
		}
	}, KILL_GRACE_MS);
	killTimer.unref?.();
	child.once("exit", () => clearTimeout(killTimer));
}

function failInitialStartup(id: string, entry: DevWatchEntry, message: string): void {
	entry.ready = false;
	entry.stopped = true;
	pluginDevLinkService.setStatus(id, "error", message);
	settleInitialStartup(entry, new Error(message));
	stopChild(entry.child);
}

function scheduleRestart(id: string, entry: DevWatchEntry, message: string): void {
	pluginDevLinkService.deactivate(id, message);
	refreshAgentPlugins();
	const delay = RESTART_DELAYS_MS[entry.restartAttempts];
	if (delay === undefined) {
		log.error(`dev-watch: restart exhausted for ${id}`, { error: message });
		return;
	}
	entry.restartAttempts += 1;
	pluginDevLinkService.setStatus(id, "starting");
	log.warn(`dev-watch: restarting ${id} in ${delay}ms`, { attempt: entry.restartAttempts, error: message });
	entry.restartTimer = setTimeout(() => {
		entry.restartTimer = null;
		spawnPluginDevServer(id, entry);
	}, delay);
}

function handleAttemptFailure(id: string, entry: DevWatchEntry, attempt: number, message: string): void {
	if (entry.stopped || entry.attempt !== attempt) return;
	if (entry.startupTimer) clearTimeout(entry.startupTimer);
	entry.startupTimer = null;
	entry.child = null;
	const initialStartupPending = entry.rejectReady !== null;
	if (initialStartupPending) {
		failInitialStartup(id, entry, message);
		return;
	}
	entry.ready = false;
	scheduleRestart(id, entry, message);
}

function handleDevServerEvent(
	id: string,
	entry: DevWatchEntry,
	attempt: number,
	event: PluginDevServerEvent,
	failAttempt: (message: string) => void,
): void {
	if (entry.stopped || entry.attempt !== attempt) return;
	if (event.pluginId !== undefined && event.pluginId !== id) {
		failAttempt(`Plugin development server id mismatch: expected ${id}, received ${event.pluginId}`);
		return;
	}
	try {
		if (event.type === "ready") {
			const plugin = pluginDevLinkService.setServer(id, event.entryUrl, event.origin);
			entry.ready = true;
			entry.restartAttempts = 0;
			if (entry.startupTimer) clearTimeout(entry.startupTimer);
			entry.startupTimer = null;
			refreshAgentPlugins();
			log.info(`dev-watch: server ready for ${id} at ${event.origin}`);
			settleInitialStartup(entry, plugin);
			return;
		}
		if (event.type === "update") {
			scheduleRefresh(id, entry);
			return;
		}
		if (!entry.ready) {
			failAttempt(event.message);
			return;
		}
		// Vite compilation and resource watcher errors are recoverable while the
		// server remains alive. A later successful update returns the state to running.
		pluginDevLinkService.setStatus(id, "error", event.message);
	} catch (error) {
		failAttempt(error instanceof Error ? error.message : String(error));
	}
}

function spawnPluginDevServer(id: string, entry: DevWatchEntry): void {
	if (entry.stopped) return;
	entry.attempt += 1;
	const attempt = entry.attempt;
	entry.ready = false;
	pluginDevLinkService.setStatus(id, "starting");

	let cliPath: string;
	try {
		cliPath = resolvePluginDevCliPath(entry.projectDir);
	} catch (error) {
		handleAttemptFailure(id, entry, attempt, error instanceof Error ? error.message : String(error));
		return;
	}

	let child: ChildProcess;
	try {
		child = spawn("node", [cliPath, "dev", "--root", entry.projectDir], {
			cwd: entry.projectDir,
			env: { ...process.env, VETTA_PLUGIN_DEV_WATCH: "1" },
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
	} catch (error) {
		handleAttemptFailure(id, entry, attempt, error instanceof Error ? error.message : String(error));
		return;
	}

	entry.child = child;
	let stdoutBuffer = "";
	let stderrTail = "";
	let attemptFailed = false;
	const failAttempt = (message: string) => {
		if (attemptFailed) return;
		attemptFailed = true;
		stopChild(child);
		handleAttemptFailure(id, entry, attempt, message);
	};
	child.stdout?.on("data", (chunk: Buffer) => {
		const parsed = parsePluginDevServerOutput(stdoutBuffer, chunk.toString());
		stdoutBuffer = parsed.remainder;
		for (const event of parsed.events) handleDevServerEvent(id, entry, attempt, event, failAttempt);
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		stderrTail = `${stderrTail}${chunk.toString()}`.slice(-4000);
	});
	child.on("error", (error) => {
		failAttempt(`plugin dev server failed to start: ${error.message}`);
	});
	child.on("exit", (code, signal) => {
		if (entry.stopped || entry.attempt !== attempt) return;
		failAttempt(`plugin dev server exited (code ${code}, signal ${signal})${stderrTail ? `\n${stderrTail}` : ""}`);
	});
	entry.startupTimer = setTimeout(() => {
		failAttempt(
			`plugin dev server did not become ready within ${STARTUP_TIMEOUT_MS / 1000}s; update @vetta-org/plugin-vite`,
		);
	}, STARTUP_TIMEOUT_MS);
	log.info(`dev-watch: starting ${id} at ${entry.projectDir}`);
}

export function startPluginDevWatch(
	id: string,
	projectDir: string,
	options: SetPluginDevLinkOptions = {},
): Promise<InstalledPlugin> {
	stopPluginDevWatch(id);
	pluginDevLinkService.set(id, projectDir, options);
	return new Promise<InstalledPlugin>((resolveReady, rejectReady) => {
		const entry: DevWatchEntry = {
			projectDir,
			child: null,
			debounceTimer: null,
			startupTimer: null,
			restartTimer: null,
			resolveReady,
			rejectReady,
			stopped: false,
			ready: false,
			attempt: 0,
			restartAttempts: 0,
		};
		entries.set(id, entry);
		spawnPluginDevServer(id, entry);
	});
}

export function stopPluginDevWatch(id: string): void {
	const entry = entries.get(id);
	if (entry) {
		entry.stopped = true;
		if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
		if (entry.startupTimer) clearTimeout(entry.startupTimer);
		if (entry.restartTimer) clearTimeout(entry.restartTimer);
		settleInitialStartup(entry, new Error(`Plugin development watch stopped: ${id}`));
		stopChild(entry.child);
		entries.delete(id);
		log.info(`dev-watch: stopped for ${id}`);
	}
	pluginDevLinkService.clear(id);
}

export function stopAllPluginDevWatches(): void {
	for (const id of Array.from(entries.keys())) {
		stopPluginDevWatch(id);
	}
}
