import { type ChildProcess, execFile } from "node:child_process";
import { createServer } from "node:net";
import { webContents } from "electron";
import type { InstalledPlugin, PluginCommandSpawnStatus } from "../../preload/api-types/plugins.js";
import { PLUGIN_EXECUTION_CHANNELS } from "../../shared/plugin-ipc.js";
import { getAppLogger } from "../logger.js";
import { createPluginCommandEnvironment } from "./command-environment.js";
import { spawnCrossPlatformCommand } from "./command-launcher.js";
import { listPlugins } from "./plugin-store.js";

const spawnLog = getAppLogger("plugin");

/** Per-plugin cap so a buggy plugin cannot fork-bomb the host. */
const MAX_SPAWNS_PER_PLUGIN = 8;
/** Combined stdout+stderr ring buffer cap per spawn (for status/diagnostics). */
const MAX_OUTPUT_BYTES = 64 * 1024;
/** Grace period between SIGTERM and SIGKILL. */
const KILL_GRACE_MS = 3_000;
/** Keep exited records around briefly so status() after exit still resolves. */
const EXITED_RECORD_TTL_MS = 5 * 60_000;

/** Placeholder substituted with the host-allocated port in args/env values. */
const PORT_PLACEHOLDER = "{{PORT}}";

interface SpawnRecord {
	spawnId: string;
	pluginId: string;
	file: string;
	child: ChildProcess;
	port?: number;
	output: string[];
	outputBytes: number;
	exit?: { exitCode: number | null; signal: string | null };
	cleanupTimer?: NodeJS.Timeout;
}

const records = new Map<string, SpawnRecord>();
let counter = 0;

function hasGrantedPermission(plugin: InstalledPlugin, permission: "agent.command.spawn"): boolean {
	return plugin.permissions.includes(permission) && plugin.grantedPermissions.includes(permission);
}

function sanitizeArgs(args: unknown): string[] {
	if (args === undefined) return [];
	if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
		throw new Error("Command args must be an array of strings");
	}
	return args as string[];
}

function sanitizeEnv(env: unknown): Record<string, string> | undefined {
	if (env === undefined) return undefined;
	if (env === null || typeof env !== "object" || Array.isArray(env)) {
		throw new Error("Command env must be a string map");
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
		if (typeof value !== "string") throw new Error(`Command env value for ${key} must be a string`);
		out[key] = value;
	}
	return out;
}

/** Ask the OS for a free port (tiny TOCTOU window; callers should use --strictPort and retry). */
function allocateFreePort(): Promise<number> {
	return new Promise((resolvePort, rejectPort) => {
		const server = createServer();
		server.unref();
		server.on("error", rejectPort);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				server.close(() => rejectPort(new Error("Failed to allocate port")));
				return;
			}
			const { port } = address;
			server.close(() => resolvePort(port));
		});
	});
}

function appendOutput(record: SpawnRecord, chunk: Buffer): void {
	const text = chunk.toString("utf8");
	record.output.push(text);
	record.outputBytes += text.length;
	while (record.outputBytes > MAX_OUTPUT_BYTES && record.output.length > 1) {
		const removed = record.output.shift();
		record.outputBytes -= removed?.length ?? 0;
	}
}

/** Kill the whole process tree (vite spawns esbuild children that outlive a plain SIGTERM). */
function killTree(record: SpawnRecord, signal: NodeJS.Signals): void {
	const { child } = record;
	if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
	if (process.platform === "win32") {
		execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {
			// best-effort; the exit listener owns state transitions
		});
		return;
	}
	try {
		// Negative pid targets the detached process group (POSIX).
		process.kill(-child.pid, signal);
	} catch {
		try {
			child.kill(signal);
		} catch {
			// already gone
		}
	}
}

function broadcastSpawnExit(record: SpawnRecord): void {
	for (const contents of webContents.getAllWebContents()) {
		if (contents.isDestroyed()) continue;
		try {
			contents.send(PLUGIN_EXECUTION_CHANNELS.COMMAND_SPAWN_EXIT, {
				pluginId: record.pluginId,
				spawnId: record.spawnId,
				exitCode: record.exit?.exitCode ?? null,
				signal: record.exit?.signal ?? null,
			});
		} catch {
			// ignore gone frames
		}
	}
}

export interface SpawnPluginCommandOptions {
	cwd?: string;
	env?: Record<string, string>;
	/** Host allocates a free port and substitutes `{{PORT}}` in args/env values. */
	allocatePort?: boolean;
}

export interface SpawnPluginCommandResult {
	spawnId: string;
	pid: number;
	port?: number;
}

/**
 * Start a long-lived plugin-declared command in the main process (ADR-0054).
 * Same authoritative gates as `runPluginCommand`, but behind the separate
 * `agent.command.spawn` permission. The shared launcher selects the managed
 * Node toolchain and safely bridges platform script shims. The child runs in
 * its own process group so stop() can kill the whole tree.
 */
export async function spawnPluginCommand(
	pluginId: string,
	file: string,
	args: unknown,
	options: SpawnPluginCommandOptions | undefined,
): Promise<SpawnPluginCommandResult> {
	if (typeof pluginId !== "string" || pluginId.trim().length === 0) {
		throw new Error("Invalid plugin id");
	}
	if (typeof file !== "string" || file.trim().length === 0) {
		throw new Error("Invalid command file");
	}
	const plugin = listPlugins().find((candidate) => candidate.id === pluginId);
	if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
	if (!plugin.enabled) throw new Error(`Plugin disabled: ${pluginId}`);
	if (plugin.trustLevel !== "official") {
		throw new Error(`Plugin command execution is restricted to official plugins: ${pluginId}`);
	}
	if (!hasGrantedPermission(plugin, "agent.command.spawn")) {
		throw new Error("Plugin permission denied: agent.command.spawn");
	}
	if (!plugin.declaredCommands.includes(file)) {
		throw new Error(`Command not declared: ${file}`);
	}
	if (!plugin.grantedCommandNames.includes(file)) {
		throw new Error(`Command disabled by user: ${file}`);
	}
	const alive = [...records.values()].filter((record) => record.pluginId === pluginId && record.exit === undefined);
	if (alive.length >= MAX_SPAWNS_PER_PLUGIN) {
		throw new Error(`Too many running commands for plugin ${pluginId} (max ${MAX_SPAWNS_PER_PLUGIN})`);
	}

	let normalizedArgs = sanitizeArgs(args);
	let env = sanitizeEnv(options?.env);
	const cwd = typeof options?.cwd === "string" && options.cwd.trim().length > 0 ? options.cwd : undefined;

	let port: number | undefined;
	if (options?.allocatePort === true) {
		port = await allocateFreePort();
		const portText = String(port);
		normalizedArgs = normalizedArgs.map((arg) => arg.split(PORT_PLACEHOLDER).join(portText));
		if (env) {
			env = Object.fromEntries(
				Object.entries(env).map(([key, value]) => [key, value.split(PORT_PLACEHOLDER).join(portText)]),
			);
		}
	}

	const child = spawnCrossPlatformCommand(file, normalizedArgs, {
		cwd,
		env: createPluginCommandEnvironment(env),
		windowsHide: true,
		// Own process group so killTree can signal children (esbuild etc.) too.
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
	});

	const spawnId = `spawn-${++counter}-${Date.now().toString(36)}`;
	const record: SpawnRecord = {
		spawnId,
		pluginId,
		file,
		child,
		port,
		output: [],
		outputBytes: 0,
	};
	records.set(spawnId, record);

	child.stdout?.on("data", (chunk: Buffer) => appendOutput(record, chunk));
	child.stderr?.on("data", (chunk: Buffer) => appendOutput(record, chunk));
	child.on("exit", (exitCode, signal) => {
		record.exit = { exitCode, signal };
		spawnLog.info("plugin spawn exited", { pluginId, spawnId, file, exitCode, signal });
		broadcastSpawnExit(record);
		record.cleanupTimer = setTimeout(() => records.delete(spawnId), EXITED_RECORD_TTL_MS);
		record.cleanupTimer.unref();
	});

	return new Promise<SpawnPluginCommandResult>((resolvePromise, rejectPromise) => {
		child.once("spawn", () => {
			spawnLog.info("plugin spawn started", { pluginId, spawnId, file, pid: child.pid, port });
			resolvePromise({ spawnId, pid: child.pid ?? -1, port });
		});
		child.once("error", (error: NodeJS.ErrnoException) => {
			records.delete(spawnId);
			spawnLog.warn("plugin spawn failed", { pluginId, file, code: error.code });
			rejectPromise(new Error(`Command failed to start: ${file} (${error.code ?? error.message})`));
		});
	});
}

/** SIGTERM, then SIGKILL after a grace period. Resolves once the process is gone. */
export async function stopPluginCommandSpawn(pluginId: string, spawnId: string): Promise<void> {
	const record = records.get(spawnId);
	if (!record || record.pluginId !== pluginId) return;
	if (record.exit !== undefined) return;
	await new Promise<void>((resolveStop) => {
		const killTimer = setTimeout(() => killTree(record, "SIGKILL"), KILL_GRACE_MS);
		killTimer.unref();
		record.child.once("exit", () => {
			clearTimeout(killTimer);
			resolveStop();
		});
		killTree(record, "SIGTERM");
	});
}

export function getPluginCommandSpawnStatus(pluginId: string, spawnId: string): PluginCommandSpawnStatus {
	const record = records.get(spawnId);
	if (!record || record.pluginId !== pluginId) {
		return { running: false, pid: -1, recentOutput: "" };
	}
	return {
		running: record.exit === undefined,
		pid: record.child.pid ?? -1,
		port: record.port,
		exit: record.exit,
		recentOutput: record.output.join(""),
	};
}

/** Kill everything a plugin started (uninstall / disable / reload). */
export function stopAllSpawnsForPlugin(pluginId: string): void {
	for (const record of records.values()) {
		if (record.pluginId !== pluginId || record.exit !== undefined) continue;
		void stopPluginCommandSpawn(pluginId, record.spawnId);
	}
}

/** Kill every plugin-spawned process (app quit). Fire-and-forget SIGKILL sweep. */
export function stopAllPluginSpawns(): void {
	for (const record of records.values()) {
		if (record.exit !== undefined) continue;
		killTree(record, "SIGKILL");
	}
}
