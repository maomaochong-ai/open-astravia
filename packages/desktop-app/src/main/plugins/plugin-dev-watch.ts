import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import {
	buildAgentPluginRuntimeConfig,
	clearPluginDevLink,
	refreshPluginDevLink,
	setPluginDevLink,
	setPluginDevLinkServer,
	setPluginDevLinkStatus,
} from "./plugin-store.js";

const log = getAppLogger("plugin");
const DEBOUNCE_MS = 80;
const KILL_GRACE_MS = 3000;

type PluginDevServerEvent =
	| { type: "ready"; pluginId: string; entryUrl: string; origin: string }
	| { type: "update"; pluginId: string }
	| { type: "error"; pluginId?: string; message: string };

interface DevWatchEntry {
	projectDir: string;
	child: ChildProcess | null;
	debounceTimer: NodeJS.Timeout | null;
	stopped: boolean;
}

const entries = new Map<string, DevWatchEntry>();

function refreshAgentPlugins(): void {
	try {
		getSharedRuntime().reconfigureAgentPlugins(buildAgentPluginRuntimeConfig());
	} catch (error) {
		log.warn("dev-watch: refresh agent plugins failed", error);
	}
}

function parseDevServerEvent(line: string): PluginDevServerEvent | undefined {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (value === null || typeof value !== "object" || !("type" in value)) return undefined;
	if (
		value.type === "ready" &&
		"pluginId" in value &&
		typeof value.pluginId === "string" &&
		"entryUrl" in value &&
		typeof value.entryUrl === "string" &&
		"origin" in value &&
		typeof value.origin === "string"
	) {
		return { type: "ready", pluginId: value.pluginId, entryUrl: value.entryUrl, origin: value.origin };
	}
	if (value.type === "update" && "pluginId" in value && typeof value.pluginId === "string") {
		return { type: "update", pluginId: value.pluginId };
	}
	if (value.type === "error" && "message" in value && typeof value.message === "string") {
		return {
			type: "error",
			pluginId: "pluginId" in value && typeof value.pluginId === "string" ? value.pluginId : undefined,
			message: value.message,
		};
	}
	return undefined;
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
			setPluginDevLinkServer(id, event.entryUrl, event.origin);
			refreshAgentPlugins();
			log.info(`dev-watch: server ready for ${id} at ${event.origin}`);
			return;
		}
		if (event.type === "update") {
			scheduleRefresh(id, entry);
			return;
		}
		setPluginDevLinkStatus(id, "error", event.message);
	} catch (error) {
		setPluginDevLinkStatus(id, "error", error instanceof Error ? error.message : String(error));
	}
}

function spawnPluginDevServer(id: string, entry: DevWatchEntry): void {
	const cliPath = join(entry.projectDir, "node_modules", "@vetta-org", "plugin-vite", "dist", "cli.js");
	if (!existsSync(cliPath)) {
		setPluginDevLinkStatus(id, "error", `plugin-vite CLI not found: ${cliPath}`);
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
		setPluginDevLinkStatus(id, "error", error instanceof Error ? error.message : String(error));
		return;
	}

	entry.child = child;
	let stdoutBuffer = "";
	let stderrTail = "";
	child.stdout?.on("data", (chunk: Buffer) => {
		stdoutBuffer += chunk.toString();
		const lines = stdoutBuffer.split(/\r?\n/);
		stdoutBuffer = lines.pop() ?? "";
		for (const line of lines) {
			const event = parseDevServerEvent(line.trim());
			if (event) handleDevServerEvent(id, entry, event);
		}
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		stderrTail = `${stderrTail}${chunk.toString()}`.slice(-4000);
	});
	child.on("error", (error) => {
		entry.child = null;
		if (entry.stopped) return;
		setPluginDevLinkStatus(id, "error", `plugin dev server failed to start: ${error.message}`);
	});
	child.on("exit", (code, signal) => {
		entry.child = null;
		if (entry.stopped) return;
		setPluginDevLinkStatus(
			id,
			"error",
			`plugin dev server exited (code ${code}, signal ${signal})${stderrTail ? `\n${stderrTail}` : ""}`,
		);
	});
}

export function startPluginDevWatch(id: string, projectDir: string): InstalledPlugin {
	stopPluginDevWatch(id);
	const plugin = setPluginDevLink(id, projectDir);
	const entry: DevWatchEntry = {
		projectDir: plugin.devWatch?.projectDir ?? projectDir,
		child: null,
		debounceTimer: null,
		stopped: false,
	};
	entries.set(id, entry);
	spawnPluginDevServer(id, entry);
	log.info(`dev-watch: started for ${id} at ${entry.projectDir}`);
	return plugin;
}

export function stopPluginDevWatch(id: string): void {
	const entry = entries.get(id);
	if (entry) {
		entry.stopped = true;
		if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
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
