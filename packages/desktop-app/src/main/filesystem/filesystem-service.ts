import type { Dirent, Stats } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { FsEntry, FsFileRef, FsStatResult } from "../../preload/fs-types.js";

const BINARY_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"svg",
	"ico",
	"pdf",
	"docx",
	"xls",
	"xlsx",
	"xlsm",
	"xlsb",
	"ods",
	"ppt",
	"pptx",
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_BINARY_FILE_SIZE = 32 * 1024 * 1024;
const HIDDEN_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const RECURSIVE_IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"out",
	"target",
	"coverage",
	".next",
	".turbo",
	".cache",
]);
const MAX_RECURSIVE_FILES = 10000;
const allowedRoots = new Set<string>();

function expandTilde(path: string): string {
	if (path.startsWith("~/") || path === "~") return join(homedir(), path.slice(1));
	return path;
}

function normalizePathForComparison(value: string): string {
	const normalized = resolve(value);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isPathWithin(root: string, targetPath: string): boolean {
	const rel = relative(normalizePathForComparison(root), normalizePathForComparison(targetPath));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isWithinAllowedRoots(targetPath: string): boolean {
	for (const root of allowedRoots) {
		if (isPathWithin(root, targetPath)) return true;
	}
	return false;
}

export function assertFilesystemPathWithinProject(targetPath: string): void {
	if (!isWithinAllowedRoots(targetPath)) {
		throw new Error("Path is outside any known project directory");
	}
}

export function allowProjectRoot(cwd: string): void {
	allowedRoots.add(resolve(cwd));
}

export function assertPathReadableForPreview(targetPath: string): void {
	if (isWithinAllowedRoots(targetPath)) return;
	if (isPathWithin(homedir(), targetPath)) return;
	throw new Error("Path is outside any previewable directory");
}

export async function readFilesystemDirectory(dirPath: string): Promise<FsEntry[]> {
	assertFilesystemPathWithinProject(dirPath);
	const resolved = resolve(dirPath);
	const entries = await readdir(resolved, { withFileTypes: true });
	const results: FsEntry[] = [];
	for (const entry of entries) {
		if (HIDDEN_FILES.has(entry.name) || entry.name.startsWith(".")) continue;
		const fullPath = join(resolved, entry.name);
		try {
			const stats = await stat(fullPath);
			results.push({
				name: entry.name,
				path: fullPath,
				isDirectory: entry.isDirectory(),
				size: stats.size,
				modifiedAt: stats.mtimeMs,
			});
		} catch {
			// Skip entries we cannot stat.
		}
	}
	results.sort((a, b) => {
		if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	});
	return results;
}

export async function readFilesystemFile(filePath: string): Promise<{ content: string; encoding: "utf8" | "base64" }> {
	assertPathReadableForPreview(filePath);
	const resolved = resolve(filePath);
	let stats: Stats;
	try {
		stats = await stat(resolved);
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { content: "", encoding: "utf8" };
		throw error;
	}
	if (stats.size > MAX_FILE_SIZE) throw new Error("File too large to preview (>10 MB)");
	const extension = extname(resolved).slice(1).toLowerCase();
	if (BINARY_EXTENSIONS.has(extension)) {
		const buffer = await readFile(resolved);
		return { content: buffer.toString("base64"), encoding: "base64" };
	}
	return { content: await readFile(resolved, "utf8"), encoding: "utf8" };
}

function detectBinaryMimeType(buffer: Buffer): string {
	if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return "image/png";
	}
	if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
	const signature = buffer.subarray(0, 6).toString("ascii");
	if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
	if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
		return "image/webp";
	}
	return "application/octet-stream";
}

export async function readFilesystemBinaryFile(
	filePath: string,
): Promise<{ data: string; mimeType: string; size: number }> {
	assertPathReadableForPreview(filePath);
	const resolved = resolve(filePath);
	const stats = await stat(resolved);
	if (!stats.isFile()) throw new Error("Path is not a file");
	if (stats.size > MAX_BINARY_FILE_SIZE) throw new Error("Binary file too large (>32 MB)");
	const buffer = await readFile(resolved);
	return {
		data: buffer.toString("base64"),
		mimeType: detectBinaryMimeType(buffer),
		size: buffer.byteLength,
	};
}

export async function writeFilesystemFile(
	filePath: string,
	content: string,
	encoding: "utf8" | "base64" = "utf8",
): Promise<void> {
	assertFilesystemPathWithinProject(filePath);
	const resolved = resolve(filePath);
	await mkdir(dirname(resolved), { recursive: true });
	if (encoding === "base64") {
		await writeFile(resolved, Buffer.from(content, "base64"));
		return;
	}
	await writeFile(resolved, content, "utf8");
}

export async function statFilesystemPath(filePath: string): Promise<FsStatResult | null> {
	assertFilesystemPathWithinProject(filePath);
	try {
		const stats = await stat(resolve(filePath));
		return { size: stats.size, modifiedAt: stats.mtimeMs, createdAt: stats.birthtimeMs };
	} catch {
		return null;
	}
}

export async function renameFilesystemPath(oldPath: string, newPath: string): Promise<void> {
	assertFilesystemPathWithinProject(oldPath);
	assertFilesystemPathWithinProject(newPath);
	await rename(resolve(oldPath), resolve(newPath));
}

export async function deleteFilesystemPath(targetPath: string): Promise<void> {
	assertFilesystemPathWithinProject(targetPath);
	await rm(resolve(targetPath), { recursive: true, force: true });
}

export async function moveFilesystemPath(sourcePath: string, destinationDirectory: string): Promise<void> {
	assertFilesystemPathWithinProject(sourcePath);
	assertFilesystemPathWithinProject(destinationDirectory);
	const resolvedSource = resolve(sourcePath);
	const resolvedDestination = join(resolve(destinationDirectory), basename(resolvedSource));
	try {
		await rename(resolvedSource, resolvedDestination);
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
		await cp(resolvedSource, resolvedDestination, { recursive: true, errorOnExist: true, force: false });
		await rm(resolvedSource, { recursive: true, force: true });
	}
}

export async function createFilesystemDirectory(dirPath: string): Promise<void> {
	await mkdir(resolve(expandTilde(dirPath)), { recursive: true });
}

export async function listFilesystemFilesRecursive(rootPath: string): Promise<FsFileRef[]> {
	assertFilesystemPathWithinProject(rootPath);
	const root = resolve(rootPath);
	const results: FsFileRef[] = [];
	async function walk(dir: string): Promise<void> {
		if (results.length >= MAX_RECURSIVE_FILES) return;
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (results.length >= MAX_RECURSIVE_FILES) return;
			if (entry.name.startsWith(".") || HIDDEN_FILES.has(entry.name)) continue;
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (RECURSIVE_IGNORED_DIRS.has(entry.name)) continue;
				await walk(fullPath);
			} else if (entry.isFile()) {
				results.push({ name: entry.name, path: fullPath, relPath: relative(root, fullPath) });
			}
		}
	}
	await walk(root);
	return results;
}
