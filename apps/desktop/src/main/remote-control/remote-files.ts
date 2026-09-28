import type { RemoteFileChunk, RemoteFileEntry, RemoteFileInfo } from "@vetta/remote-control";
import { REMOTE_FILE_CHUNK_BYTES, REMOTE_MAX_FILE_BYTES } from "@vetta/remote-control";
import { isSshProjectUri } from "@vetta/ssh-transport/project-uri";
import type { FsEntry } from "../../preload/fs-types.js";
import type { PreviewFileSource } from "../filesystem/preview-file-source.js";
import { RemoteOperationError } from "./remote-error-mapping.js";
import {
	canonicalRemoteFilePath,
	displayRemoteFilePath,
	isBlockedForPhone,
	isInsideSessionDirectory,
	type RemotePathContext,
	type RemotePathFlavor,
	resolveRemoteFileTarget,
} from "./remote-file-paths.js";

/** The desktop I/O the phone's file requests go through; the same code paths the file panel and preview use. */
export interface RemoteFileSystem {
	readDirectory(path: string): Promise<FsEntry[]>;
	/** Throws when the path is outside what the desktop's own preview may read. */
	openSource(path: string): PreviewFileSource;
	/** Where a local path's symlinks lead; the path itself when it does not exist. */
	realpath(path: string): Promise<string>;
	/** A scaled-down JPEG of an image, or undefined to send it as it is. */
	scaleImage(bytes: Buffer): Buffer | undefined;
}

export interface RemoteFilesOptions {
	readonly fs: RemoteFileSystem;
	readonly home: string;
	readonly path: RemotePathFlavor;
	readonly now?: () => number;
}

interface PreparedContent {
	readonly bytes: Buffer;
	readonly mimeType: string;
	readonly modifiedAt: number;
	readonly at: number;
}

/** A multi-chunk read reuses what it prepared instead of reading (over SSH) and scaling once per chunk. */
const CACHE_ENTRIES = 4;
const CACHE_TTL_MS = 60_000;
/** Largest image read before scaling; the desktop's own binary preview limit. */
const MAX_IMAGE_SOURCE_BYTES = 32 * 1024 * 1024;
const SCALABLE_IMAGES = new Set(["png", "jpg", "jpeg", "heic", "heif", "tif", "tiff", "bmp", "webp"]);
const HIDDEN_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	html: "text/html",
	htm: "text/html",
	xhtml: "application/xhtml+xml",
	md: "text/markdown",
	markdown: "text/markdown",
	mdx: "text/markdown",
	txt: "text/plain",
	log: "text/plain",
	csv: "text/csv",
	tsv: "text/tab-separated-values",
	json: "application/json",
	xml: "application/xml",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	heic: "image/heic",
	heif: "image/heif",
	bmp: "image/bmp",
	tif: "image/tiff",
	tiff: "image/tiff",
	ico: "image/x-icon",
	pdf: "application/pdf",
	rtf: "application/rtf",
	doc: "application/msword",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xls: "application/vnd.ms-excel",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	ppt: "application/vnd.ms-powerpoint",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	key: "application/vnd.apple.keynote",
	pages: "application/vnd.apple.pages",
	numbers: "application/vnd.apple.numbers",
	mp3: "audio/mpeg",
	m4a: "audio/mp4",
	wav: "audio/wav",
	mp4: "video/mp4",
	m4v: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	zip: "application/zip",
};

function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function baseName(target: string): string {
	const parts = target.split(/[\\/]+/).filter(Boolean);
	return parts[parts.length - 1] ?? target;
}

/** Guessed from the extension; a chunk's `mimeType` says what was actually sent. */
export function remoteMimeType(name: string): string {
	return MIME_BY_EXTENSION[extensionOf(name)] ?? "application/octet-stream";
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function forbidden(): RemoteOperationError {
	return new RemoteOperationError("forbidden", "This file cannot be viewed from the phone");
}

function notFound(): RemoteOperationError {
	return new RemoteOperationError("not_found", "File was not found");
}

function isMissing(error: unknown): boolean {
	const code = asRecord(error).code;
	return code === "ENOENT" || code === "ENOTDIR" || (error instanceof Error && /no such file/i.test(error.message));
}

/**
 * Serves `file.list`, `file.stat` and `file.read` for one paired phone
 * (ADR-0139). Paths resolve against the session's working directory; reads
 * stay inside the desktop's preview scope minus the phone's blocklist, and
 * listings inside the working directory.
 */
export class RemoteFiles {
	private readonly cache = new Map<string, PreparedContent>();
	private readonly now: () => number;

	constructor(private readonly options: RemoteFilesOptions) {
		this.now = options.now ?? Date.now;
	}

	async list(cwd: string, payload: unknown): Promise<{ path: string; entries: RemoteFileEntry[] }> {
		const context = this.context(cwd);
		const input = asRecord(payload).path;
		const target = resolveRemoteFileTarget(typeof input === "string" && input ? input : ".", context);
		if (!isInsideSessionDirectory(target, context)) throw forbidden();
		await this.assertNotBlocked(target, context);
		if (!isSshProjectUri(target)) {
			// A symlinked folder must not let the listing wander out of the working directory.
			const [real, realCwd] = await Promise.all([this.options.fs.realpath(target), this.options.fs.realpath(cwd)]);
			if (!isInsideSessionDirectory(real, { ...context, cwd: realCwd })) throw forbidden();
		}
		let entries: FsEntry[];
		try {
			entries = await this.options.fs.readDirectory(target);
		} catch (error) {
			if (isMissing(error)) throw notFound();
			throw forbidden();
		}
		return {
			path: canonicalRemoteFilePath(target, context),
			entries: entries
				.filter((entry) => !entry.name.startsWith(".") && !HIDDEN_FILES.has(entry.name))
				.filter((entry) => !isBlockedForPhone(entry.path, context))
				.map((entry) => ({
					name: entry.name,
					path: canonicalRemoteFilePath(entry.path, context),
					isDirectory: entry.isDirectory,
					size: entry.isDirectory ? 0 : entry.size,
					modifiedAt: entry.modifiedAt,
				})),
		};
	}

	async stat(cwd: string, payload: unknown): Promise<{ file: RemoteFileInfo }> {
		const context = this.context(cwd);
		const target = await this.resolveReadable(asRecord(payload).path, context);
		const source = this.open(target);
		const stats = await this.statOf(source);
		const name = baseName(target);
		return {
			file: {
				name,
				path: canonicalRemoteFilePath(target, context),
				isDirectory: !stats.isFile,
				size: stats.isFile ? stats.size : 0,
				modifiedAt: stats.modifiedAt,
				mimeType: stats.isFile ? remoteMimeType(name) : "inode/directory",
				displayPath: displayRemoteFilePath(target, context),
			},
		};
	}

	async read(cwd: string, payload: unknown): Promise<RemoteFileChunk> {
		const request = asRecord(payload);
		const offset = typeof request.offset === "number" && Number.isSafeInteger(request.offset) ? request.offset : -1;
		if (offset < 0) throw new RemoteOperationError("invalid_frame", "offset is required");
		const length =
			typeof request.length === "number" && request.length > 0
				? Math.min(Math.floor(request.length), REMOTE_FILE_CHUNK_BYTES)
				: REMOTE_FILE_CHUNK_BYTES;
		const context = this.context(cwd);
		const target = await this.resolveReadable(request.path, context);
		const source = this.open(target);
		const stats = await this.statOf(source);
		if (!stats.isFile) throw new RemoteOperationError("invalid_frame", "Path is a folder");
		if (typeof request.modifiedAt === "number" && request.modifiedAt !== stats.modifiedAt) {
			throw new RemoteOperationError("file_changed", "The file changed while it was being read", true);
		}
		const content = await this.prepare(target, source, stats);
		if (offset > content.bytes.byteLength) throw new RemoteOperationError("invalid_frame", "offset is past the end");
		return {
			data: content.bytes.subarray(offset, offset + length).toString("base64"),
			offset,
			totalSize: content.bytes.byteLength,
			modifiedAt: content.modifiedAt,
			mimeType: content.mimeType,
		};
	}

	private context(cwd: string): RemotePathContext {
		return { cwd, home: this.options.home, path: this.options.path };
	}

	private async resolveReadable(input: unknown, context: RemotePathContext): Promise<string> {
		if (typeof input !== "string" || !input.trim())
			throw new RemoteOperationError("invalid_frame", "path is required");
		const target = resolveRemoteFileTarget(input, context);
		await this.assertNotBlocked(target, context);
		return target;
	}

	private async assertNotBlocked(target: string, context: RemotePathContext): Promise<void> {
		if (isBlockedForPhone(target, context)) throw forbidden();
		if (isSshProjectUri(target)) return;
		if (isBlockedForPhone(await this.options.fs.realpath(target), context)) throw forbidden();
	}

	private open(target: string): PreviewFileSource {
		try {
			return this.options.fs.openSource(target);
		} catch {
			throw forbidden();
		}
	}

	private async statOf(source: PreviewFileSource): Promise<{ size: number; isFile: boolean; modifiedAt: number }> {
		let stats: Awaited<ReturnType<PreviewFileSource["stat"]>>;
		try {
			stats = await source.stat();
		} catch (error) {
			if (isMissing(error)) throw notFound();
			throw error;
		}
		if (!stats) throw notFound();
		return stats;
	}

	private async prepare(
		target: string,
		source: PreviewFileSource,
		stats: { size: number; modifiedAt: number },
	): Promise<PreparedContent> {
		const key = `${target}\0${stats.modifiedAt}\0${stats.size}`;
		const cached = this.cache.get(key);
		const now = this.now();
		if (cached && now - cached.at < CACHE_TTL_MS) return cached;
		this.cache.delete(key);

		const name = baseName(target);
		const scalable = SCALABLE_IMAGES.has(extensionOf(name));
		const limit = scalable ? MAX_IMAGE_SOURCE_BYTES : REMOTE_MAX_FILE_BYTES;
		if (stats.size > limit) throw tooLarge();
		const original = await source.read();
		const scaled = scalable ? this.options.fs.scaleImage(original) : undefined;
		const bytes = scaled ?? original;
		if (bytes.byteLength > REMOTE_MAX_FILE_BYTES) throw tooLarge();
		const content: PreparedContent = {
			bytes,
			mimeType: scaled ? "image/jpeg" : remoteMimeType(name),
			modifiedAt: stats.modifiedAt,
			at: now,
		};
		this.cache.set(key, content);
		for (const [staleKey, entry] of this.cache) {
			if (this.cache.size <= CACHE_ENTRIES && now - entry.at < CACHE_TTL_MS) break;
			this.cache.delete(staleKey);
		}
		return content;
	}
}

function tooLarge(): RemoteOperationError {
	return new RemoteOperationError("too_large", "The file is too large to view on the phone");
}
