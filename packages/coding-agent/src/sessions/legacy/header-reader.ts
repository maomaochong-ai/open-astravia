import { closeSync, openSync, readSync } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";

/** Maximum prefix needed to identify a historical Coding Agent JSONL header. */
const SESSION_HEADER_READ_BYTES = 64 * 1024;

export async function isLegacySessionFile(sessionPath: string): Promise<boolean> {
	try {
		return isLegacySessionHeader(await readFirstLine(sessionPath));
	} catch {
		return false;
	}
}

export function isLegacySessionFileSync(sessionPath: string): boolean {
	try {
		return isLegacySessionHeader(readFirstLineSync(sessionPath));
	} catch {
		return false;
	}
}

function isLegacySessionHeader(firstLine: string | undefined): boolean {
	if (!firstLine) return false;
	try {
		const value: unknown = JSON.parse(firstLine);
		return (
			typeof value === "object" &&
			value !== null &&
			"type" in value &&
			value.type === "session" &&
			"cwd" in value &&
			typeof value.cwd === "string"
		);
	} catch {
		return false;
	}
}

async function readFirstLine(path: string): Promise<string | undefined> {
	let handle: FileHandle | undefined;
	try {
		handle = await open(path, "r");
		const buffer = Buffer.alloc(SESSION_HEADER_READ_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		return firstCompleteLine(buffer, bytesRead);
	} finally {
		await handle?.close();
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
