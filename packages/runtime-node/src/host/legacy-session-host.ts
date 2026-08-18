import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, unlinkSync, writeSync } from "node:fs";
import { appendFile, open, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import type { LegacySessionImportEntryNormalizer } from "@vetta/runtime-storage/conversation";
import {
	currentProcessStartedAtMs,
	isLocalProcessAlive,
	migrateLegacySessionToV2,
	readLocalProcessStartedAtMs,
} from "../conversation/index.js";

const SESSION_HEADER_READ_BYTES = 64 * 1024;
const PROCESS_START_TOLERANCE_MS = 5_000;

export interface NodeLegacySessionHostOptions {
	readonly sessionsDirectory: string;
	readonly defaultCwd: string;
}

export interface NodeLegacySessionFormatLeaseHolder {
	readonly pid: number;
	readonly hostname: string;
	readonly openedAt: string;
	readonly processStartedAt?: string;
}

export type NodeLegacySessionFormatLeaseResult =
	| { readonly kind: "acquired"; readonly lease: { readonly lockPath: string; release(): void } }
	| {
			readonly kind: "locked";
			readonly lockPath: string;
			readonly holder: NodeLegacySessionFormatLeaseHolder;
	  };

/** Node implementation for Coding Agent's product-owned historical-session policy. */
export function createNodeLegacySessionHost(options: NodeLegacySessionHostOptions) {
	const acquireLease = (path: string) => acquireNodeLegacySessionLease(path);
	return {
		sessionsDirectory: options.sessionsDirectory,
		defaultCwd: options.defaultCwd,
		join: (...parts: readonly string[]) => join(...parts),
		exists: existsSync,
		readText: (path: string) => readFileSync(path, "utf8"),
		readFirstLine: readFirstLine,
		readFirstLineSync: readFirstLineSync,
		async readDirectory(path: string) {
			return (await readdir(path, { withFileTypes: true })).map((entry) => ({
				name: entry.name,
				kind: entry.isFile()
					? ("file" as const)
					: entry.isDirectory()
						? ("directory" as const)
						: ("other" as const),
			}));
		},
		statModifiedAt: async (path: string) => (await stat(path)).mtimeMs,
		appendText: (path: string, content: string) => appendFile(path, content, "utf8").then(() => undefined),
		remove: (path: string) => rm(path, { force: true }),
		createRandomId: randomUUID,
		acquireLease,
		canonicalize: async (path: string) => realpath(resolve(path)),
		readBytes: (path: string) => readFile(path),
		digest(parts: readonly [string, Uint8Array]) {
			return createHash("sha256").update(parts[0]).update("\0").update(parts[1]).digest("base64url");
		},
		migrate: (migrationOptions: {
			readonly sourcePath: string;
			readonly targetRootDir: string;
			readonly targetSessionId: string;
			readonly reuseIdenticalTarget: boolean;
			readonly entryNormalizer: LegacySessionImportEntryNormalizer;
		}) => migrateLegacySessionToV2(migrationOptions),
	};
}

function acquireNodeLegacySessionLease(sessionPath: string): NodeLegacySessionFormatLeaseResult {
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
			if (nodeErrorCode(error) !== "EEXIST") throw error;
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
		const holder: NodeLegacySessionFormatLeaseHolder = {
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

function readLeaseHolder(lockPath: string): NodeLegacySessionFormatLeaseHolder | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
		if (typeof value !== "object" || value === null) return undefined;
		const pid = Reflect.get(value, "pid");
		const lockHostname = Reflect.get(value, "hostname");
		const openedAt = Reflect.get(value, "openedAt");
		if (typeof pid !== "number" || typeof lockHostname !== "string" || typeof openedAt !== "string") return undefined;
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

function isProcessAlive(holder: NodeLegacySessionFormatLeaseHolder): boolean {
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

async function readFirstLine(path: string): Promise<string | undefined> {
	const handle = await open(path, "r");
	try {
		const buffer = Buffer.alloc(SESSION_HEADER_READ_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		return firstCompleteLine(buffer, bytesRead);
	} finally {
		await handle.close();
	}
}

function readFirstLineSync(path: string): string | undefined {
	const descriptor = openSync(path, "r");
	try {
		const buffer = Buffer.alloc(SESSION_HEADER_READ_BYTES);
		return firstCompleteLine(buffer, readSync(descriptor, buffer, 0, buffer.length, 0));
	} finally {
		closeSync(descriptor);
	}
}

function firstCompleteLine(buffer: Buffer, bytesRead: number): string | undefined {
	const text = buffer.toString("utf8", 0, bytesRead);
	const newline = text.indexOf("\n");
	if (newline === -1 && bytesRead === buffer.length) return undefined;
	return (newline === -1 ? text : text.slice(0, newline)).replace(/\r$/, "") || undefined;
}

function nodeErrorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
		? error.code
		: undefined;
}
