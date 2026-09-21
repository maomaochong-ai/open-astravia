import { createServer } from "node:net";
import { isSshProjectUri, RemoteProjectNotSupportedError } from "@vetta/ssh-transport";
import { webContents } from "electron";
import type { InstalledPlugin, PluginCommandSpawnStatus } from "../../preload/api-types/plugins.js";
import { PLUGIN_EXECUTION_CHANNELS } from "../../shared/plugin-ipc.js";
import { getAppLogger } from "../logger.js";
import { listPlugins } from "./plugin-catalog.js";
import { type SpawnedProcess, startProcess } from "./spawned-process.js";

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
	process: SpawnedProcess;
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
	// 长驻进程（dev server、预览引擎）靠本机端口与渲染进程通信，项目在远端时它读不到项目
	// 文件，搬到远端执行则本机连不上它的端口。明确拒绝，而不是让 spawn 以一句看似「本机
	// 没装 node」的 ENOENT 失败。
	// 只有声明要本机端口的才真的没法远程：那类进程（dev server、预览引擎）靠端口与界面
	// 通信，搬到远端则本机连不上。其余长跑命令（npm install、构建）必须在项目所在的机器
	// 上执行，否则它看不到任何项目文件——交给下面按 cwd 归属分流。
	if (options?.allocatePort === true && cwd !== undefined && isSshProjectUri(cwd)) {
		throw new RemoteProjectNotSupportedError(`plugin command "${file}" (needs a local port)`, cwd);
	}

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

	const spawned = startProcess({ file, args: normalizedArgs, cwd, env });

	const spawnId = `spawn-${++counter}-${Date.now().toString(36)}`;
	const record: SpawnRecord = {
		spawnId,
		pluginId,
		file,
		process: spawned,
		port,
		output: [],
		outputBytes: 0,
	};
	records.set(spawnId, record);

	spawned.onOutput((chunk: Buffer) => appendOutput(record, chunk));
	spawned.onExit((exitCode, signal) => {
		record.exit = { exitCode, signal };
		spawnLog.info("plugin spawn exited", { pluginId, spawnId, file, exitCode, signal });
		broadcastSpawnExit(record);
		record.cleanupTimer = setTimeout(() => records.delete(spawnId), EXITED_RECORD_TTL_MS);
		record.cleanupTimer.unref();
	});

	try {
		await spawned.whenStarted();
	} catch (error) {
		records.delete(spawnId);
		spawnLog.warn("plugin spawn failed", { pluginId, file, error: String(error) });
		throw error;
	}
	spawnLog.info("plugin spawn started", { pluginId, spawnId, file, pid: spawned.pid, port });
	return { spawnId, pid: spawned.pid, port };
}

/** SIGTERM, then SIGKILL after a grace period. Resolves once the process is gone. */
export async function stopPluginCommandSpawn(pluginId: string, spawnId: string): Promise<void> {
	const record = records.get(spawnId);
	if (!record || record.pluginId !== pluginId) return;
	if (record.exit !== undefined) return;
	await new Promise<void>((resolveStop) => {
		const killTimer = setTimeout(() => record.process.kill("SIGKILL"), KILL_GRACE_MS);
		killTimer.unref();
		record.process.onExit(() => {
			clearTimeout(killTimer);
			resolveStop();
		});
		record.process.kill("SIGTERM");
	});
}

export function getPluginCommandSpawnStatus(pluginId: string, spawnId: string): PluginCommandSpawnStatus {
	const record = records.get(spawnId);
	if (!record || record.pluginId !== pluginId) {
		return { running: false, pid: -1, recentOutput: "" };
	}
	return {
		running: record.exit === undefined,
		pid: record.process.pid,
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
		record.process.kill("SIGKILL");
	}
}
