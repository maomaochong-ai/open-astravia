import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { PersistedImageResult, PersistImageFileInput, PersistImageInput } from "../../shared/image-cache.js";

const EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
	"image/bmp": "bmp",
	"image/gif": "gif",
	"image/x-icon": "ico",
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/svg+xml": "svg",
	"image/webp": "webp",
};

const IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ImageCacheDependencies {
	cacheRoot: string;
	mkdir: typeof mkdir;
	readFile: typeof readFile;
	readdir: typeof readdir;
	rm: typeof rm;
	stat: typeof stat;
	writeFile: typeof writeFile;
}

const DEFAULT_DEPENDENCIES: ImageCacheDependencies = {
	cacheRoot: join(getVettaHomePath(), "image-cache"),
	mkdir,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
};

function sanitizeSegment(value: string): string {
	const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, "_");
	return sanitized === "." || sanitized === ".." ? "_" : sanitized;
}

function normalizedFormat(mimeType: string): string {
	const format = mimeType.split("/")[1]?.toLowerCase();
	if (format === "jpeg") return "jpg";
	if (format === "svg+xml") return "svg";
	return format || "unknown";
}

function extensionForMimeType(mimeType: string): string {
	return Object.hasOwn(EXTENSION_BY_MIME_TYPE, mimeType) ? (EXTENSION_BY_MIME_TYPE[mimeType] ?? "png") : "png";
}

function readUint24LE(bytes: Buffer, offset: number): number {
	return bytes.readUIntLE(offset, 3);
}

function readJpegDimensions(bytes: Buffer): { width: number; height: number } | undefined {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
	let offset = 2;
	while (offset + 8 < bytes.length) {
		while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
		while (offset < bytes.length && bytes[offset] === 0xff) offset++;
		if (offset >= bytes.length) return undefined;
		const marker = bytes[offset++];
		if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
		if (offset + 1 >= bytes.length) return undefined;
		const segmentLength = bytes.readUInt16BE(offset);
		if (segmentLength < 2 || offset + segmentLength > bytes.length) return undefined;
		if (
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf)
		) {
			return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
		}
		offset += segmentLength;
	}
	return undefined;
}

function readWebpDimensions(bytes: Buffer): { width: number; height: number } | undefined {
	if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
		return undefined;
	}
	const chunk = bytes.toString("ascii", 12, 16);
	if (chunk === "VP8X") {
		return { width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 };
	}
	if (chunk === "VP8L" && bytes[20] === 0x2f) {
		const bits = bytes.readUInt32LE(21);
		return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
	}
	if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
		return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
	}
	return undefined;
}

function readSvgDimensions(bytes: Buffer): { width: number; height: number } | undefined {
	const source = bytes.toString("utf8", 0, Math.min(bytes.length, 64 * 1024));
	const svg = /<svg\b[^>]*>/i.exec(source)?.[0];
	if (!svg) return undefined;
	const width = Number.parseFloat(/\bwidth\s*=\s*["']\s*([0-9.]+)/i.exec(svg)?.[1] ?? "");
	const height = Number.parseFloat(/\bheight\s*=\s*["']\s*([0-9.]+)/i.exec(svg)?.[1] ?? "");
	if (width > 0 && height > 0) return { width, height };
	const viewBox = /\bviewBox\s*=\s*["']\s*[-0-9.]+[ ,]+[-0-9.]+[ ,]+([0-9.]+)[ ,]+([0-9.]+)/i.exec(svg);
	const viewBoxWidth = Number.parseFloat(viewBox?.[1] ?? "");
	const viewBoxHeight = Number.parseFloat(viewBox?.[2] ?? "");
	return viewBoxWidth > 0 && viewBoxHeight > 0 ? { width: viewBoxWidth, height: viewBoxHeight } : undefined;
}

export function readImageDimensions(bytes: Buffer, mimeType: string): { width: number; height: number } | undefined {
	if (mimeType === "image/png" && bytes.length >= 24 && bytes.toString("hex", 0, 8) === "89504e470d0a1a0a") {
		return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
	}
	if (mimeType === "image/gif" && bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) {
		return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
	}
	if (mimeType === "image/bmp" && bytes.length >= 26 && bytes.toString("ascii", 0, 2) === "BM") {
		const dibSize = bytes.readUInt32LE(14);
		if (dibSize === 12) return { width: bytes.readUInt16LE(18), height: bytes.readUInt16LE(20) };
		return { width: Math.abs(bytes.readInt32LE(18)), height: Math.abs(bytes.readInt32LE(22)) };
	}
	if (mimeType === "image/x-icon" && bytes.length >= 8 && bytes.readUInt16LE(0) === 0) {
		const width = bytes[6] ?? 0;
		const height = bytes[7] ?? 0;
		return { width: width || 256, height: height || 256 };
	}
	if (mimeType === "image/jpeg") return readJpegDimensions(bytes);
	if (mimeType === "image/webp") return readWebpDimensions(bytes);
	if (mimeType === "image/svg+xml") return readSvgDimensions(bytes);
	return undefined;
}

async function writeCachedImage(
	directory: string,
	id: string,
	mimeType: string,
	bytes: Buffer,
	dependencies: ImageCacheDependencies,
): Promise<PersistedImageResult> {
	const fileName = `${sanitizeSegment(id) || "img"}.${extensionForMimeType(mimeType)}`;
	const path = join(directory, fileName);
	await dependencies.writeFile(path, bytes);
	const dimensions = readImageDimensions(bytes, mimeType);
	return {
		path,
		format: normalizedFormat(mimeType),
		sizeBytes: bytes.byteLength,
		...(dimensions ?? {}),
	};
}

export async function persistImageCache(
	sessionId: string,
	images: readonly PersistImageInput[],
	dependencies: ImageCacheDependencies = DEFAULT_DEPENDENCIES,
): Promise<PersistedImageResult[]> {
	if (typeof sessionId !== "string" || !sessionId || images.length === 0) return [];
	const directory = join(dependencies.cacheRoot, sanitizeSegment(sessionId));
	await dependencies.mkdir(directory, { recursive: true });
	const results: PersistedImageResult[] = [];
	for (const image of images) {
		if (
			!image ||
			typeof image.id !== "string" ||
			typeof image.data !== "string" ||
			!image.data ||
			typeof image.mimeType !== "string"
		) {
			continue;
		}
		const bytes = Buffer.from(image.data, "base64");
		results.push(await writeCachedImage(directory, image.id, image.mimeType, bytes, dependencies));
	}
	return results;
}

/**
 * Persist clipboard/drop File objects without converting compressed bytes to
 * base64 in the renderer. Real files are read by main; virtual clipboard files
 * arrive as ArrayBuffer through structured clone.
 */
export async function persistImageFileCache(
	sessionId: string,
	images: readonly PersistImageFileInput[],
	dependencies: ImageCacheDependencies = DEFAULT_DEPENDENCIES,
): Promise<PersistedImageResult[]> {
	if (typeof sessionId !== "string" || !sessionId || images.length === 0) return [];
	const directory = join(dependencies.cacheRoot, sanitizeSegment(sessionId));
	await dependencies.mkdir(directory, { recursive: true });
	const results: PersistedImageResult[] = [];
	for (const image of images) {
		if (!image || typeof image.id !== "string" || typeof image.mimeType !== "string" || !image.source) continue;
		let bytes: Buffer;
		if (image.source.kind === "file-path" && typeof image.source.path === "string" && image.source.path) {
			bytes = await dependencies.readFile(image.source.path);
		} else if (image.source.kind === "bytes") {
			const sourceData: unknown = image.source.data;
			if (!(sourceData instanceof ArrayBuffer) && !Buffer.isBuffer(sourceData)) continue;
			bytes = Buffer.isBuffer(sourceData) ? sourceData : Buffer.from(sourceData);
		} else {
			continue;
		}
		results.push(await writeCachedImage(directory, image.id, image.mimeType, bytes, dependencies));
	}
	return results;
}

export async function cleanupOldImageCaches(
	now = Date.now(),
	dependencies: ImageCacheDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
	let names: string[];
	try {
		names = await dependencies.readdir(dependencies.cacheRoot);
	} catch {
		return;
	}
	await Promise.all(
		names.map(async (name) => {
			const directory = join(dependencies.cacheRoot, name);
			try {
				const entry = await dependencies.stat(directory);
				if (entry.isDirectory() && now - entry.mtimeMs > IMAGE_CACHE_TTL_MS) {
					await dependencies.rm(directory, { recursive: true, force: true });
				}
			} catch {
				// A stale or concurrently removed cache directory does not affect other entries.
			}
		}),
	);
}
