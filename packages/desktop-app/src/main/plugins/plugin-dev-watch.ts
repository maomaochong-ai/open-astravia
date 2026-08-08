import { type ChildProcess, spawn } from "node:child_process";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { resolvePluginDevCliPath } from "./plugin-dev-cli.js";
import { type PluginDevServerEvent, parsePluginDevServerOutput } from "./plugin-dev-protocol.js";
import {
	buildAgentPluginRuntimeConfig,
	clearPluginDevLink,
	refreshPluginDevLink,
	type SetPluginDevLinkOptions,
	setPluginDevLink,
	setPluginDevLinkServer,
	setPluginDevLinkStatus,
} from "./plugin-store.js";

const log = getAppLogger("plugin");
const DEBOUNCE_MS = 80;
const KILL_GRACE_MS = 3000;
const STARTUP_TIMEOUT_MS = 15_000;

interface DevWatchEntry {
	projectDir: string;
	child: ChildProcess | null;
	debounceTimer: NodeJS.Timeout | null;
	startupTimer: NodeJS.Timeout | null;
	resolveReady: ((plugin: InstalledPlugin) => void) | null;
	rejectReady: ((error: Error) => void) | null;
	stopped: boolean;
}

const entries = new Map<string, DevWatchEntry>();

function settleStartup(entry: DevWatchEntry, result: InstalledPlugin | Error): void {
	if (entry.startupTimer) clearTimeout(entry.startupTimer);
	entry.startupTimer = null;
	if (result instanceof Error) entry.rejectReady?.(result);
	else entry.resolveReady?.(result);
	entry.resolveReady = null;
	entry.rejectReady = null;
}

function failStartup(id: string, entry: DevWatchEntry, message: string): void {
	const startupPending = entry.rejectReady !== null;
	setPluginDevLinkStatus(id, "error", message);
	settleStartup(entry, new Error(message));
	if (startupPending) {
		entry.stopped = true;
		if (entry.child && !entry.child.killed) entry.child.kill();
	}
}

function refreshAgentPlugins(): void {
	try {
		getSharedRuntime().reconfigureAgentPlugins(buildAgentPluginRuntimeConfig());
	} catch (error) {
		log.warn("dev-watch: refresh agent plugins failed", error);
	}
}

function scheduleRefresh(id: string, entry: DevWatchEntry): void {
	if (entry.stopped) return;
	if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
	entry.debounceTimer = setTimeout(() => {
		entry.debounceTimer = null;
		if (entry.stopped) return;
		try {
			refreshPluginDevLink(id);
			refreshAgentPlugins();
			log.info(`dev-watch: refreshed ${id}`);
		} catch (error) {
			log.warn(`dev-watch: reload failed for ${id}`, error);
			setPluginDevLinkStatus(id, "error", error instanceof Error ? error.message : String(error));
		}
	}, DEBOUNCE_MS);
}

function handleDevServerEvent(id: string, entry: DevWatchEntry, event: PluginDevServerEvent): void {
	if (entry.stopped || (event.pluginId !== undefined && event.pluginId !== id)) return;
	try {
		if (event.type === "ready") {
			const plugin = setPluginDevLinkServer(id, event.entryUrl, event.origin);
			refreshAgentPlugins();
			log.info(`dev-watch: server ready for ${id} at ${event.origin}`);
			settleStartup(entry, plugin);
			return;
		}
		if (event.type === "update") {
			scheduleRefresh(id, entry);
			return;
		}
		failStartup(id, entry, event.message);
	} catch (error) {
		failStartup(id, entry, error instanceof Error ? error.message : String(error));
	}
}

function spawnPluginDevServer(id: string, entry: DevWatchEntry): void {
	let cliPath: string;
	try {
		cliPath = resolvePluginDevCliPath(entry.projectDir);
	} catch (error) {
		failStartup(id, entry, error instanceof Error ? error.message : String(error));
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
		failStartup(id, entry, error instanceof Error ? error.message : String(error));
		return;
	}

	entry.child = child;
	let stdoutBuffer = "";
	let stderrTail = "";
	child.stdout?.on("data", (chunk: Buffer) => {
		const parsed = parsePluginDevServerOutput(stdoutBuffer, chunk.toString());
		stdoutBuffer = parsed.remainder;
		for (const event of parsed.events) handleDevServerEvent(id, entry, event);
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		stderrTail = `${stderrTail}${chunk.toString()}`.slice(-4000);
	});
	child.on("error", (error) => {
		entry.child = null;
		if (entry.stopped) return;
		failStartup(id, entry, `plugin dev server failed to start: ${error.message}`);
	});
	child.on("exit", (code, signal) => {
		entry.child = null;
		if (entry.stopped) return;
		failStartup(
			id,
			entry,
			`plugin dev server exited (code ${code}, signal ${signal})${stderrTail ? `\n${stderrTail}` : ""}`,
		);
	});
}

export function startPluginDevWatch(
	id: string,
	projectDir: string,
	options: SetPluginDevLinkOptions = {},
): Promise<InstalledPlugin> {
	stopPluginDevWatch(id);
	const plugin = setPluginDevLink(id, projectDir, options);
	return new Promise<InstalledPlugin>((resolveReady, rejectReady) => {
		const entry: DevWatchEntry = {
			projectDir: plugin.devWatch?.projectDir ?? projectDir,
			child: null,
			debounceTimer: null,
			startupTimer: null,
			resolveReady,
			rejectReady,
			stopped: false,
		};
		entry.startupTimer = setTimeout(() => {
			failStartup(
				id,
				entry,
				`plugin dev server did not become ready within ${STARTUP_TIMEOUT_MS / 1000}s; update @vetta-org/plugin-vite`,
			);
		}, STARTUP_TIMEOUT_MS);
		entries.set(id, entry);
		spawnPluginDevServer(id, entry);
		log.info(`dev-watch: started for ${id} at ${entry.projectDir}`);
	});
}

export function stopPluginDevWatch(id: string): void {
	const entry = entries.get(id);
	if (entry) {
		entry.stopped = true;
		if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
		settleStartup(entry, new Error(`Plugin development watch stopped: ${id}`));
		const child = entry.child;
		if (child && !child.killed) {
			try {
				child.kill();
			} catch {
				// already gone
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
		entries.delete(id);
		log.info(`dev-watch: stopped for ${id}`);
	}
	clearPluginDevLink(id);
}

export function stopAllPluginDevWatches(): void {
	for (const id of Array.from(entries.keys())) {
		stopPluginDevWatch(id);
	}
}
