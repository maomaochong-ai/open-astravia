/**
 * Session file locking.
 *
 * Sessions are .jsonl files written by SessionManager. The file format has no
 * concurrent-write support: two SessionManager instances pointing at the same
 * file silently corrupt each other's history. Their in-memory entry arrays
 * diverge from disk, and the next compaction's _rewriteFile() wipes the
 * other process's appends.
 *
 * This module enforces a single-writer rule via a sentinel `<sessionFile>.lock`
 * created with O_EXCL. The lockfile records pid + hostname + process start time
 * + openedAt. If acquisition fails, we probe whether the holder is still the
 * *same process instance* (not merely a live pid — Windows reuses pids aggressively).
 * Stale locks (dead pids, PID reuse, or unreadable lockfiles) are reclaimed.
 *
 * The lock is advisory: any cooperating process must call acquireSessionLock
 * before opening a session file. Hosts (rpc mode, RuntimeHost in desktop-app,
 * direct SDK consumers) all flow through SessionManager, so the SessionManager
 * lifecycle is the single choke point that participates.
 */

import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { performance } from "node:perf_hooks";

export interface SessionLockInfo {
	pid: number;
	hostname: string;
	openedAt: string;
	/**
	 * Wall-clock process start time (ISO), used to detect PID reuse.
	 * Optional for backward compatibility with older lockfiles.
	 */
	processStartedAt?: string;
}

export class SessionLockError extends Error {
	constructor(
		public readonly lockPath: string,
		public readonly holder: SessionLockInfo,
	) {
		super(
			`Session file is in use by another process ` +
				`(pid ${holder.pid}@${holder.hostname}, opened ${holder.openedAt}). ` +
				`Lock file: ${lockPath}`,
		);
		this.name = "SessionLockError";
	}
}

export interface SessionLockHandle {
	readonly lockPath: string;
	release(): void;
}

/** Tolerate clock / API resolution differences when comparing process start times. */
const START_TIME_TOLERANCE_MS = 5_000;

/** Paths of lockfiles currently held by this process (for best-effort exit cleanup). */
const heldLockPaths = new Set<string>();
let exitHookInstalled = false;

function installExitHook(): void {
	if (exitHookInstalled) return;
	exitHookInstalled = true;
	const cleanup = () => {
		for (const lockPath of heldLockPaths) {
			try {
				unlinkSync(lockPath);
			} catch {
				// Best effort on process teardown.
			}
		}
		heldLockPaths.clear();
	};
	process.once("exit", cleanup);
	// Sync signals: still try to drop sentinels before default exit.
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
		try {
			process.once(signal, () => {
				cleanup();
			});
		} catch {
			// Signal not supported on this platform (e.g. Windows SIGHUP).
		}
	}
}

function lockPathFor(sessionFile: string): string {
	return `${sessionFile}.lock`;
}

function hostnamesEqual(a: string, b: string): boolean {
	return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

/**
 * Wall-clock start time of this process (ms since epoch).
 * `performance.timeOrigin` is the process time origin in Node.
 */
function selfProcessStartMs(): number {
	return Math.floor(performance.timeOrigin);
}

/**
 * Best-effort wall-clock start time of an arbitrary pid.
 * Returns undefined when the process cannot be inspected (dead, permission, unsupported).
 */
function getProcessStartMs(pid: number): number | undefined {
	if (!Number.isInteger(pid) || pid <= 0) return undefined;
	if (pid === process.pid) return selfProcessStartMs();

	try {
		if (process.platform === "linux") {
			return getLinuxProcessStartMs(pid);
		}
		if (process.platform === "darwin") {
			return getDarwinProcessStartMs(pid);
		}
		if (process.platform === "win32") {
			return getWindowsProcessStartMs(pid);
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function getLinuxProcessStartMs(pid: number): number | undefined {
	// /proc/<pid>/stat field 22 = starttime in clock ticks after boot.
	const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
	const closed = raw.lastIndexOf(")");
	if (closed < 0) return undefined;
	const fields = raw.slice(closed + 2).split(/\s+/);
	// After ") ": index 0 = state (field 3), starttime is field 22 → index 19.
	const startTicks = Number(fields[19]);
	if (!Number.isFinite(startTicks)) return undefined;
	const uptimeSec = Number(readFileSync("/proc/uptime", "utf8").split(/\s+/)[0]);
	if (!Number.isFinite(uptimeSec)) return undefined;
	// CLK_TCK is 100 on virtually all Linux configs we care about.
	const CLK_TCK = 100;
	const startMs = Date.now() - uptimeSec * 1000 + (startTicks / CLK_TCK) * 1000;
	return Math.floor(startMs);
}

function getDarwinProcessStartMs(pid: number): number | undefined {
	// etimes = elapsed seconds since process start.
	const out = execFileSync("ps", ["-p", String(pid), "-o", "etimes="], {
		encoding: "utf8",
		timeout: 2000,
	}).trim();
	const elapsedSec = Number(out);
	if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return undefined;
	return Math.floor(Date.now() - elapsedSec * 1000);
}

function getWindowsProcessStartMs(pid: number): number | undefined {
	// PowerShell is available on all supported desktop targets; only runs on lock conflict.
	const out = execFileSync(
		"powershell.exe",
		[
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			`([DateTimeOffset](Get-Process -Id ${pid}).StartTime).ToUnixTimeMilliseconds()`,
		],
		{
			encoding: "utf8",
			timeout: 5000,
			windowsHide: true,
		},
	).trim();
	const ms = Number(out);
	if (!Number.isFinite(ms) || ms <= 0) return undefined;
	return Math.floor(ms);
}

/**
 * Whether `pid` exists on this host.
 * EPERM means the process exists but we cannot signal it — treat as alive.
 */
function isPidReachable(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err: unknown) {
		const code = (err as NodeJS.ErrnoException).code;
		return code === "EPERM";
	}
}

/**
 * True when the lock holder still looks like the same process instance that wrote the lock.
 * False → safe to reclaim (dead, PID reused, cross-check failed open).
 *
 * Cross-host locks cannot be probed → assumed held (shared filesystem safety).
 */
function isLockHolderAlive(holder: SessionLockInfo): boolean {
	if (!hostnamesEqual(holder.hostname, hostname())) {
		return true;
	}
	if (!isPidReachable(holder.pid)) {
		return false;
	}

	const liveStart = getProcessStartMs(holder.pid);
	const recordedStart = holder.processStartedAt ? Date.parse(holder.processStartedAt) : Number.NaN;
	const openedAt = Date.parse(holder.openedAt);

	if (liveStart != null && Number.isFinite(recordedStart)) {
		// Same pid + matching start time ⇒ original holder still running.
		return Math.abs(liveStart - recordedStart) <= START_TIME_TOLERANCE_MS;
	}

	// Legacy lockfiles (no processStartedAt): if the live process started *after*
	// the lock was written, the pid was reused by an unrelated process.
	if (liveStart != null && Number.isFinite(openedAt)) {
		if (liveStart > openedAt + START_TIME_TOLERANCE_MS) {
			return false;
		}
	}

	// Pid is reachable and we cannot prove reuse → assume still held.
	return true;
}

function readLockInfo(lockPath: string): SessionLockInfo | undefined {
	try {
		const raw = readFileSync(lockPath, "utf8");
		const parsed = JSON.parse(raw) as Partial<SessionLockInfo>;
		if (
			typeof parsed.pid === "number" &&
			typeof parsed.hostname === "string" &&
			typeof parsed.openedAt === "string"
		) {
			const info: SessionLockInfo = {
				pid: parsed.pid,
				hostname: parsed.hostname,
				openedAt: parsed.openedAt,
			};
			if (typeof parsed.processStartedAt === "string") {
				info.processStartedAt = parsed.processStartedAt;
			}
			return info;
		}
	} catch {
		// Unreadable / malformed lockfile — treated as stale
	}
	return undefined;
}

function writeLockFile(lockPath: string): void {
	// "wx" = O_WRONLY | O_CREAT | O_EXCL. Throws EEXIST if the file already exists,
	// guaranteeing we are the sole creator.
	const fd = openSync(lockPath, "wx");
	try {
		const info: SessionLockInfo = {
			pid: process.pid,
			hostname: hostname(),
			openedAt: new Date().toISOString(),
			processStartedAt: new Date(selfProcessStartMs()).toISOString(),
		};
		writeSync(fd, JSON.stringify(info));
	} finally {
		closeSync(fd);
	}
}

/**
 * Acquire an exclusive advisory lock on a session file.
 *
 * - Throws SessionLockError if another live process instance holds the lock.
 * - Stale locks (dead pids, PID reuse on the same host, malformed files) are reclaimed.
 * - The lock is released by calling `handle.release()`. release() is idempotent.
 */
export function acquireSessionLock(sessionFile: string): SessionLockHandle {
	installExitHook();
	const lockPath = lockPathFor(sessionFile);

	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			writeLockFile(lockPath);
			heldLockPaths.add(lockPath);
			let released = false;
			return {
				lockPath,
				release() {
					if (released) return;
					released = true;
					heldLockPaths.delete(lockPath);
					try {
						unlinkSync(lockPath);
					} catch {
						// Best effort: lockfile may have been removed externally.
					}
				},
			};
		} catch (err: unknown) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") throw err;

			const holder = readLockInfo(lockPath);
			if (holder && isLockHolderAlive(holder)) {
				throw new SessionLockError(lockPath, holder);
			}

			// Stale lock — try to remove it and retry. If a race causes
			// the unlink to fail, the next attempt's writeLockFile will surface it.
			try {
				unlinkSync(lockPath);
			} catch {
				// Race: another process already cleaned up. Retry will recreate.
			}
		}
	}

	throw new Error(`Failed to acquire session lock at ${lockPath} after retry`);
}
