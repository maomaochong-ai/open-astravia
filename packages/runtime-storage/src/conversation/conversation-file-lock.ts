import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { open, readFile, rm, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { CONVERSATION_STORAGE_ERROR_CODES, ConversationStorageError } from "./errors.js";
import { nodeErrorCode } from "./node-error-code.js";

const FILE_LOCK_RETRY_COUNT = 100;
const FILE_LOCK_RETRY_DELAY_MS = 10;
const FILE_LOCK_STALE_MS = 5 * 60 * 1000;

export async function acquireConversationFileLock(path: string, sessionId: string): Promise<() => Promise<void>> {
	const token = randomUUID();
	for (let attempt = 0; attempt < FILE_LOCK_RETRY_COUNT; attempt += 1) {
		let handle: FileHandle | undefined;
		try {
			handle = await open(path, "wx");
			await handle.writeFile(token, "utf8");
			await handle.close();
			handle = undefined;
			return async () => {
				try {
					if ((await readFile(path, "utf8")) === token) await rm(path, { force: true });
				} catch (error) {
					if (nodeErrorCode(error) !== "ENOENT") throw error;
				}
			};
		} catch (error) {
			await handle?.close();
			if (nodeErrorCode(error) !== "EEXIST") throw error;
			if (await isStaleLock(path)) {
				await rm(path, { force: true });
				continue;
			}
			await delay(FILE_LOCK_RETRY_DELAY_MS);
		}
	}
	throw new ConversationStorageError(
		CONVERSATION_STORAGE_ERROR_CODES.WRITE_LOCK_TIMEOUT,
		`Timed out acquiring conversation file lock: ${sessionId}`,
	);
}

async function isStaleLock(path: string): Promise<boolean> {
	try {
		return Date.now() - (await stat(path)).mtimeMs >= FILE_LOCK_STALE_MS;
	} catch (error) {
		if (nodeErrorCode(error) === "ENOENT") return false;
		throw error;
	}
}
