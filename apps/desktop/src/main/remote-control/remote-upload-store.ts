import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { RemoteUploadKind } from "@vetta/remote-control";

const UPLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NAME_CHARS = 80;

export interface RemoteUpload {
	readonly kind: RemoteUploadKind;
	readonly name: string;
	readonly mimeType: string;
	readonly bytes: Buffer;
}

export interface RemoteUploadStoreDependencies {
	readonly root: string;
	readonly mkdir: typeof mkdir;
	readonly readdir: typeof readdir;
	readonly rm: typeof rm;
	readonly stat: typeof stat;
	readonly writeFile: typeof writeFile;
	readonly now: () => number;
	readonly id: () => string;
}

const DEFAULT_DEPENDENCIES: RemoteUploadStoreDependencies = {
	root: join(getVettaHomePath(), "remote-uploads"),
	mkdir,
	readdir,
	rm,
	stat,
	writeFile,
	now: Date.now,
	id: randomUUID,
};

/**
 * A file name from the phone, made safe to use as the last path segment: no
 * separators, no leading dots, no control characters, bounded length.
 */
export function safeUploadName(name: string, kind: RemoteUploadKind): string {
	const cleaned = name
		.normalize("NFC")
		.replace(/[\p{Cc}\\/:*?"<>|]+/gu, "_")
		.replace(/^[.\s]+/, "")
		.trim();
	const fallback = kind === "image" ? "image" : "file";
	if (!cleaned) return fallback;
	if (cleaned.length <= MAX_NAME_CHARS) return cleaned;
	const dot = cleaned.lastIndexOf(".");
	const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
	return cleaned.slice(0, MAX_NAME_CHARS - extension.length) + extension;
}

/**
 * Writes what a paired phone attached to a prompt, so the runtime can hand the
 * agent a real path like it does for files dropped on the desktop. Each upload
 * gets its own directory, so two uploads with the same name never collide, and
 * directories older than a week are swept on the next write.
 */
export async function saveRemoteUpload(
	sessionKey: string,
	upload: RemoteUpload,
	dependencies: RemoteUploadStoreDependencies = DEFAULT_DEPENDENCIES,
): Promise<string> {
	await sweepOldUploads(dependencies);
	const directory = join(dependencies.root, safeSegment(sessionKey), dependencies.id());
	await dependencies.mkdir(directory, { recursive: true });
	const path = join(directory, safeUploadName(upload.name, upload.kind));
	await dependencies.writeFile(path, upload.bytes);
	return path;
}

async function sweepOldUploads(dependencies: RemoteUploadStoreDependencies): Promise<void> {
	let sessions: string[];
	try {
		sessions = await dependencies.readdir(dependencies.root);
	} catch {
		return;
	}
	const cutoff = dependencies.now() - UPLOAD_TTL_MS;
	for (const session of sessions) {
		const sessionDir = join(dependencies.root, session);
		let uploads: string[];
		try {
			uploads = await dependencies.readdir(sessionDir);
		} catch {
			continue;
		}
		for (const upload of uploads) {
			const uploadDir = join(sessionDir, upload);
			try {
				if ((await dependencies.stat(uploadDir)).mtimeMs < cutoff) {
					await dependencies.rm(uploadDir, { recursive: true, force: true });
				}
			} catch {
				// Racing another sweep or a removed file is fine.
			}
		}
	}
}

function safeSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "session";
}
