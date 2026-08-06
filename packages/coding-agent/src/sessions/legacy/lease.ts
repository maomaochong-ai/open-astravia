import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import {
	currentProcessStartedAtMs,
	isLocalProcessAlive,
	readLocalProcessStartedAtMs,
} from "@vetta/runtime-storage/conversation";

const PROCESS_START_TOLERANCE_MS = 5_000;

export interface LegacySessionFormatLeaseHolder {
	readonly pid: number;
	readonly hostname: string;
	readonly openedAt: string;
	readonly processStartedAt?: string;
}

export interface LegacySessionFormatLease {
	readonly lockPath: string;
	release(): void;
}

export type LegacySessionFormatLeaseResult =
	| { readonly kind: "acquired"; readonly lease: LegacySessionFormatLease }
	| {
			readonly kind: "locked";
			readonly lockPath: string;
			readonly holder: LegacySessionFormatLeaseHolder;
	  };

/** Acquire the historical JSONL advisory lock without creating an execution runtime. */
export function acquireLegacySessionFormatLease(sessionPath: string): LegacySessionFormatLeaseResult {
	const lockPath = `${sessionPath}.lock`;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			writeLease(lockPath);
			let released = false;
			return {
				kind: "acquired",
				lease: {
					lockPath,
					release() {
						if (released) return;
						released = true;
						try {
							unlinkSync(lockPath);
						} catch {
							// Best effort: another process may already have removed the lease.
						}
					},
				},
			};
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const holder = readLeaseHolder(lockPath);
			if (holder && isProcessAlive(holder)) return { kind: "locked", lockPath, holder };
			try {
				unlinkSync(lockPath);
			} catch {
				// A concurrent cleanup is harmless; the next exclusive create decides ownership.
			}
		}
	}
	throw new Error(`Failed to acquire Legacy session lease at ${lockPath} after retry`);
}

function writeLease(lockPath: string): void {
	const descriptor = openSync(lockPath, "wx");
	try {
		const holder: LegacySessionFormatLeaseHolder = {
			pid: process.pid,
			hostname: hostname(),
			openedAt: new Date().toISOString(),
			processStartedAt: new Date(currentProcessStartedAtMs()).toISOString(),
		};
		writeSync(descriptor, JSON.stringify(holder));
	} finally {
		closeSync(descriptor);
	}
}

function readLeaseHolder(lockPath: string): LegacySessionFormatLeaseHolder | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
		if (typeof value !== "object" || value === null) return undefined;
		const pid = Reflect.get(value, "pid");
		const lockHostname = Reflect.get(value, "hostname");
		const openedAt = Reflect.get(value, "openedAt");
		if (typeof pid !== "number" || typeof lockHostname !== "string" || typeof openedAt !== "string") {
			return undefined;
		}
		const processStartedAt = Reflect.get(value, "processStartedAt");
		return {
			pid,
			hostname: lockHostname,
			openedAt,
			...(typeof processStartedAt === "string" ? { processStartedAt } : {}),
		};
	} catch {
		return undefined;
	}
}

function isProcessAlive(holder: LegacySessionFormatLeaseHolder): boolean {
	if (holder.hostname !== hostname()) return true;
	if (!isLocalProcessAlive(holder.pid)) return false;
	const liveStartedAt = readLocalProcessStartedAtMs(holder.pid);
	if (liveStartedAt === undefined) return true;
	const recordedStartedAt = holder.processStartedAt ? Date.parse(holder.processStartedAt) : Number.NaN;
	if (Number.isFinite(recordedStartedAt)) {
		return Math.abs(liveStartedAt - recordedStartedAt) <= PROCESS_START_TOLERANCE_MS;
	}
	const openedAt = Date.parse(holder.openedAt);
	return !Number.isFinite(openedAt) || liveStartedAt <= openedAt + PROCESS_START_TOLERANCE_MS;
}
