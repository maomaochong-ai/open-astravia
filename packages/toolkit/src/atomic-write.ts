import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * On Windows a rename onto a file fails with EPERM, EACCES or EBUSY while anything
 * holds that file open: an antivirus or indexer scanning what was just written, a
 * reader mid-read. Such holds last moments, so the rename is tried again a few times.
 */
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const SYNC_RENAME_ATTEMPTS = 10;
const ASYNC_RENAME_ATTEMPTS = 30;
const RENAME_BACKOFF_MS = 10;
const MAX_RENAME_BACKOFF_MS = 100;

let tempSequence = 0;

/** A temp name unique to this write, so concurrent writes to one path never share it. */
function tempPathFor(path: string): string {
	tempSequence += 1;
	return `${path}.${process.pid}.${tempSequence}.tmp`;
}

function isRetryableRename(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	return code !== undefined && RETRYABLE_RENAME_CODES.has(code);
}

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameBackoffMs(attempt: number): number {
	return Math.min(attempt * RENAME_BACKOFF_MS, MAX_RENAME_BACKOFF_MS);
}

function renameWithRetry(from: string, to: string): void {
	for (let attempt = 1; ; attempt += 1) {
		try {
			renameSync(from, to);
			return;
		} catch (error) {
			if (!isRetryableRename(error) || attempt >= SYNC_RENAME_ATTEMPTS) {
				rmSync(from, { force: true });
				throw error;
			}
			sleepSync(renameBackoffMs(attempt));
		}
	}
}

async function renameWithRetryAsync(from: string, to: string): Promise<void> {
	for (let attempt = 1; ; attempt += 1) {
		try {
			await rename(from, to);
			return;
		} catch (error) {
			if (!isRetryableRename(error) || attempt >= ASYNC_RENAME_ATTEMPTS) {
				await rm(from, { force: true });
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, renameBackoffMs(attempt)));
		}
	}
}

/**
 * Atomically write a string to disk.
 *
 * Uses the standard write-temp → fsync → rename pattern. A crash, power loss,
 * or process kill at any point cannot leave a partial / corrupt target file:
 * either the rename has happened (new content) or it hasn't (old content).
 * The temporary file may be left behind on crash; each write uses its own
 * (pid and sequence suffix), so concurrent writers never collide. A rename the
 * platform refuses for a moment (see RETRYABLE_RENAME_CODES) is tried again.
 *
 * The parent directory is created if it does not exist.
 */
export function atomicWriteFile(path: string, data: string): void {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const tmpPath = tempPathFor(path);
	const fd = openSync(tmpPath, "w");
	try {
		writeSync(fd, data);
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	renameWithRetry(tmpPath, path);
}

/**
 * Atomically write a value as pretty-printed JSON.
 *
 * Convenience wrapper around atomicWriteFile for the common case of writing
 * a config / state file. Uses 2-space indentation to match existing config files.
 */
export function atomicWriteJSON(path: string, value: unknown): void {
	atomicWriteFile(path, JSON.stringify(value, null, 2));
}

export async function atomicWriteFileAsync(path: string, data: string): Promise<void> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true });

	const tmpPath = tempPathFor(path);
	const file = await open(tmpPath, "w");
	try {
		await file.writeFile(data);
		await file.sync();
	} finally {
		await file.close();
	}
	await renameWithRetryAsync(tmpPath, path);
}

export async function atomicWriteJSONAsync(path: string, value: unknown): Promise<void> {
	await atomicWriteFileAsync(path, JSON.stringify(value, null, 2));
}
