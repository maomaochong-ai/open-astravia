export interface PluginCommandRunOptions {
	/** Working directory. Must resolve inside a host-allowed root (e.g. a project). */
	cwd?: string;
	/** Extra environment entries, merged over the host process env (PATH preserved). */
	env?: Record<string, string>;
	/** Hard timeout in ms; the host clamps to its own maximum. */
	timeoutMs?: number;
}

export interface PluginCommandRunResult {
	stdout: string;
	stderr: string;
	/** Process exit code; null when the process was killed by a signal/timeout. */
	exitCode: number | null;
}

import type { Disposable } from "./disposable.js";

export interface PluginCommandSpawnOptions {
	/** Working directory. Must resolve inside a host-allowed root (e.g. a project). */
	cwd?: string;
	/** Extra environment entries, merged over the host process env (PATH preserved). */
	env?: Record<string, string>;
	/**
	 * Ask the host to allocate a free localhost port. Every literal `{{PORT}}`
	 * in args/env values is substituted with it, and the handle exposes `port`.
	 */
	allocatePort?: boolean;
}

export interface PluginCommandSpawnExit {
	exitCode: number | null;
	signal: string | null;
}

export interface PluginCommandSpawnStatus {
	running: boolean;
	pid: number;
	port?: number;
	exit?: PluginCommandSpawnExit;
	/** Ring-buffered combined stdout+stderr tail (~64KB), for diagnostics. */
	recentOutput: string;
}

/** Handle to a long-lived process started via {@link PluginCommandApi.spawn}. */
export interface PluginCommandSpawnHandle {
	spawnId: string;
	pid: number;
	/** Present when `allocatePort` was requested. */
	port?: number;
	/** SIGTERM the process tree; SIGKILL after a grace period. Idempotent. */
	stop(): Promise<void>;
	status(): Promise<PluginCommandSpawnStatus>;
	/** Fires once when the process exits (any reason). */
	onExit(listener: (exit: PluginCommandSpawnExit) => void): Disposable;
}

/**
 * Run an allowed host command (e.g. `git`). execFile semantics — NO shell, args
 * are passed as an array (no string splitting, no injection). The executable
 * must be declared in plugin.json's `commands` and currently enabled by the
 * user; otherwise the call is rejected (and the host notifies the user). Needs
 * the `agent.command.run` permission.
 *
 * `spawn` starts a long-lived process instead (ADR-0054, e.g. a local dev
 * server): same manifest `commands` declaration and user toggle, but gated by
 * the separate `agent.command.spawn` permission. The child runs in its own
 * process group; the host kills the whole tree on stop, plugin unload/disable,
 * and app quit.
 */
export interface PluginCommandApi {
	run(file: string, args?: string[], options?: PluginCommandRunOptions): Promise<PluginCommandRunResult>;
	spawn(file: string, args?: string[], options?: PluginCommandSpawnOptions): Promise<PluginCommandSpawnHandle>;
}
