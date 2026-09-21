import type { Dirent } from "node:fs";
import { cp, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { isSshProjectUri } from "@vetta/ssh-transport";
import {
	FILE_EXPLORER_ENTRY_EXISTS_ERROR,
	getFileExplorerEntryNameIssue,
} from "../../preload/file-explorer-entry-name.js";
import {
	type FileExplorerEntryKind,
	FS_EDITABLE_TEXT_ERROR,
	type FsEditableTextSnapshot,
	type FsEntry,
	type FsFileRef,
	type FsSaveEditableTextOptions,
	type FsSaveEditableTextResult,
	type FsStatResult,
	type FsTextPreviewResult,
} from "../../preload/fs-types.js";
import { isConversationWorkspaceDirEntry } from "../conversations/session-paths.js";
import {
	decodeEditableText,
	encodeEditableText,
	getFileRevision,
	MAX_EDITABLE_TEXT_FILE_SIZE,
} from "./editable-text.js";
import type { PreviewFileSource } from "./preview-file-source.js";
import {
	allowRemoteProjectRoot,
	assertRemotePathWithinProject,
	createRemoteDirectory,
	createRemoteEntry,
	deleteRemotePath,
	listRemoteFilesRecursive,
	moveRemotePath,
	openRemotePreviewSource,
	readRemoteDirectory,
	readRemoteEditableTextFile,
	renameRemotePath,
	saveRemoteEditableTextFile,
	statRemotePath,
	writeRemoteFile,
} from "./remote-filesystem.js";
import { decodeProbableUtf8Prefix, decodeProbableUtf8Text } from "./text-content.js";

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
const MAX_TEXT_PROBE_SIZE = 64 * 1024;
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
	// 与 {@link assertFilesystemRealPathWithinProject} 同理：远程路径有自己的授权根，
	// 落到本机那套里只会把合法的远程路径一律拒掉。
	if (isSshProjectUri(targetPath)) {
		assertRemotePathWithinProject(targetPath);
		return;
	}
	if (!isWithinAllowedRoots(targetPath)) {
		throw new Error("Path is outside any known project directory");
	}
}

/** 同时解析现有祖先路径，阻止项目目录内的符号链接跳出授权根。 */
export async function assertFilesystemRealPathWithinProject(targetPath: string): Promise<void> {
	// 远程路径有自己的授权根。不能落到下面的本机检查：那里会把 URI resolve 到本机进程
	// cwd 之下，要么把合法的远程路径拒掉，要么（开发态）对着本机的幽灵路径放行。
	if (isSshProjectUri(targetPath)) {
		assertRemotePathWithinProject(targetPath);
		return;
	}
	assertFilesystemPathWithinProject(targetPath);
	let existingPath = resolve(targetPath);
	while (true) {
		try {
			await lstat(existingPath);
			break;
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const parent = dirname(existingPath);
			if (parent === existingPath) throw new Error("Path has no existing ancestor");
			existingPath = parent;
		}
	}

	const canonicalTarget = await realpath(existingPath);
	for (const root of allowedRoots) {
		try {
			if (isPathWithin(await realpath(root), canonicalTarget)) return;
		} catch {
			// Ignore stale project roots that no longer exist.
		}
	}
	throw new Error("Resolved path is outside any known project directory");
}

export function allowProjectRoot(cwd: string): void {
	// 远程项目走另一套授权根：远端路径是 POSIX 且大小写敏感，混进本地这套按本机规则
	// 归一化的集合里，`/srv/App` 和 `/srv/app` 会互相授权。
	if (isSshProjectUri(cwd)) {
		allowRemoteProjectRoot(cwd);
		return;
	}
	allowedRoots.add(resolve(cwd));
}

export function assertPathReadableForPreview(targetPath: string): void {
	// 远端文件只按远程项目的授权根判定。本机这套里「家目录一律可预览」的放行在远端没有
	// 对应物，拿本机规则去判远端路径只会把合法的远端文件一概拒掉。
	if (isSshProjectUri(targetPath)) {
		assertRemotePathWithinProject(targetPath);
		return;
	}
	if (isWithinAllowedRoots(targetPath)) return;
	if (isPathWithin(homedir(), targetPath)) return;
	throw new Error("Path is outside any previewable directory");
}

export async function readFilesystemDirectory(dirPath: string): Promise<FsEntry[]> {
	if (isSshProjectUri(dirPath)) return readRemoteDirectory(dirPath);
	assertFilesystemPathWithinProject(dirPath);
	const resolved = resolve(dirPath);
	const entries = await readdir(resolved, { withFileTypes: true });
	const results: FsEntry[] = [];
	for (const entry of entries) {
		if (HIDDEN_FILES.has(entry.name) || entry.name.startsWith(".")) continue;
		// 「对话」根下的会话工作区目录是内部状态，不进入 UI 列举（ADR-0007 修订）。
		if (entry.isDirectory() && isConversationWorkspaceDirEntry(resolved, entry.name)) continue;
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

function openPreviewSource(filePath: string): PreviewFileSource {
	if (isSshProjectUri(filePath)) return openRemotePreviewSource(filePath);
	assertPathReadableForPreview(filePath);
	const resolved = resolve(filePath);
	return {
		path: resolved,
		stat: async () => {
			try {
				const stats = await stat(resolved);
				return { size: stats.size, isFile: stats.isFile() };
			} catch (error: unknown) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			}
		},
		read: () => readFile(resolved),
		readHead: async (byteCount) => {
			const buffer = Buffer.allocUnsafe(byteCount);
			const handle = await open(resolved, "r");
			try {
				const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
				return buffer.subarray(0, bytesRead);
			} finally {
				await handle.close();
			}
		},
	};
}

export async function readFilesystemFile(filePath: string): Promise<{ content: string; encoding: "utf8" | "base64" }> {
	const source = openPreviewSource(filePath);
	const stats = await source.stat();
	if (!stats) return { content: "", encoding: "utf8" };
	if (stats.size > MAX_FILE_SIZE) throw new Error("File too large to preview (>10 MB)");
	const extension = extname(source.path).slice(1).toLowerCase();
	const buffer = await source.read();
	return BINARY_EXTENSIONS.has(extension)
		? { content: buffer.toString("base64"), encoding: "base64" }
		: { content: buffer.toString("utf8"), encoding: "utf8" };
}

/**
 * Content-based fallback for files without a declared preview renderer.
 * Binary data is reported explicitly instead of reaching the renderer as
 * replacement-character-filled text.
 */
export async function readTextPreviewFile(filePath: string): Promise<FsTextPreviewResult> {
	const source = openPreviewSource(filePath);
	const stats = await source.stat();
	if (!stats) throw new Error("Path does not exist");
	if (!stats.isFile) throw new Error("Path is not a file");

	const probe = await source.readHead(Math.min(stats.size, MAX_TEXT_PROBE_SIZE));
	const decodedProbe = stats.size > probe.byteLength ? decodeProbableUtf8Prefix(probe) : decodeProbableUtf8Text(probe);
	if (!decodedProbe) return { status: "binary", size: stats.size };
	if (stats.size > MAX_FILE_SIZE) throw new Error("File too large to preview (>10 MB)");

	const buffer = await source.read();
	const decoded = decodeProbableUtf8Text(buffer);
	if (!decoded) return { status: "binary", size: buffer.byteLength };
	return { status: "text", content: decoded.content, size: buffer.byteLength };
}

export async function readEditableTextFile(filePath: string): Promise<FsEditableTextSnapshot> {
	if (isSshProjectUri(filePath)) return readRemoteEditableTextFile(filePath);
	assertFilesystemPathWithinProject(filePath);
	const resolved = resolve(filePath);
	const stats = await stat(resolved);
	if (!stats.isFile()) throw new Error(FS_EDITABLE_TEXT_ERROR.NOT_FILE);
	if (stats.size > MAX_EDITABLE_TEXT_FILE_SIZE) throw new Error(FS_EDITABLE_TEXT_ERROR.TOO_LARGE);
	const buffer = await readFile(resolved);
	const decoded = decodeEditableText(buffer);
	return {
		...decoded,
		revision: getFileRevision(buffer),
		size: buffer.byteLength,
		modifiedAt: stats.mtimeMs,
	};
}

export async function saveEditableTextFile(
	filePath: string,
	content: string,
	options: FsSaveEditableTextOptions,
): Promise<FsSaveEditableTextResult> {
	if (isSshProjectUri(filePath)) return saveRemoteEditableTextFile(filePath, content, options);
	assertFilesystemPathWithinProject(filePath);
	const resolved = resolve(filePath);
	const current = await readFile(resolved);
	const currentRevision = getFileRevision(current);
	if (!options.force && currentRevision !== options.expectedRevision) {
		return { status: "conflict", revision: currentRevision };
	}

	const nextBuffer = encodeEditableText(content, options.hasBom);
	if (nextBuffer.byteLength > MAX_EDITABLE_TEXT_FILE_SIZE) {
		throw new Error(FS_EDITABLE_TEXT_ERROR.TOO_LARGE);
	}
	await writeFile(resolved, nextBuffer);
	const stats = await stat(resolved);
	return {
		status: "saved",
		revision: getFileRevision(nextBuffer),
		size: nextBuffer.byteLength,
		modifiedAt: stats.mtimeMs,
	};
}

const BINARY_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	mp4: "video/mp4",
	m4v: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
};

function detectBinaryMimeType(buffer: Buffer, filePath: string): string {
	if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return "image/png";
	}
	if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
	const signature = buffer.subarray(0, 6).toString("ascii");
	if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
	if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
		return "image/webp";
	}
	return BINARY_MIME_BY_EXTENSION[extname(filePath).slice(1).toLowerCase()] ?? "application/octet-stream";
}

export async function readFilesystemBinaryFile(
	filePath: string,
): Promise<{ data: string; mimeType: string; size: number }> {
	const source = openPreviewSource(filePath);
	const stats = await source.stat();
	if (!stats?.isFile) throw new Error("Path is not a file");
	if (stats.size > MAX_BINARY_FILE_SIZE) throw new Error("Binary file too large (>32 MB)");
	const buffer = await source.read();
	return {
		data: buffer.toString("base64"),
		mimeType: detectBinaryMimeType(buffer, source.path),
		size: buffer.byteLength,
	};
}

export async function writeFilesystemFile(
	filePath: string,
	content: string,
	encoding: "utf8" | "base64" = "utf8",
): Promise<void> {
	if (isSshProjectUri(filePath)) {
		return writeRemoteFile(filePath, Buffer.from(content, encoding === "base64" ? "base64" : "utf8"));
	}
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
	if (isSshProjectUri(filePath)) return statRemotePath(filePath);
	assertFilesystemPathWithinProject(filePath);
	try {
		const stats = await stat(resolve(filePath));
		return { size: stats.size, modifiedAt: stats.mtimeMs, createdAt: stats.birthtimeMs };
	} catch {
		return null;
	}
}

export async function renameFilesystemPath(oldPath: string, newPath: string): Promise<void> {
	if (isSshProjectUri(oldPath) || isSshProjectUri(newPath)) return renameRemotePath(oldPath, newPath);
	assertFilesystemPathWithinProject(oldPath);
	assertFilesystemPathWithinProject(newPath);
	await rename(resolve(oldPath), resolve(newPath));
}

export async function deleteFilesystemPath(targetPath: string): Promise<void> {
	if (isSshProjectUri(targetPath)) return deleteRemotePath(targetPath);
	assertFilesystemPathWithinProject(targetPath);
	await rm(resolve(targetPath), { recursive: true, force: true });
}

export async function moveFilesystemPath(sourcePath: string, destinationDirectory: string): Promise<void> {
	if (isSshProjectUri(sourcePath) || isSshProjectUri(destinationDirectory)) {
		return moveRemotePath(sourcePath, destinationDirectory);
	}
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
	if (isSshProjectUri(dirPath)) return createRemoteDirectory(dirPath);
	await mkdir(resolve(expandTilde(dirPath)), { recursive: true });
}

export async function createFilesystemEntry(
	parentDirectory: string,
	name: string,
	kind: FileExplorerEntryKind,
): Promise<FsEntry> {
	if (isSshProjectUri(parentDirectory)) return createRemoteEntry(parentDirectory, name, kind);
	assertFilesystemPathWithinProject(parentDirectory);
	const issue = getFileExplorerEntryNameIssue(name, { windows: process.platform === "win32" });
	if (issue) throw new Error(`FILE_EXPLORER_INVALID_ENTRY_NAME:${issue}`);

	const resolvedParent = resolve(parentDirectory);
	const targetPath = join(resolvedParent, name);
	if (dirname(targetPath) !== resolvedParent) throw new Error("FILE_EXPLORER_INVALID_ENTRY_NAME:path-separator");
	assertFilesystemPathWithinProject(targetPath);

	try {
		if (kind === "directory") {
			await mkdir(targetPath);
		} else {
			const handle = await open(targetPath, "wx");
			await handle.close();
		}
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new Error(FILE_EXPLORER_ENTRY_EXISTS_ERROR);
		}
		throw error;
	}

	const stats = await stat(targetPath);
	return {
		name,
		path: targetPath,
		isDirectory: kind === "directory",
		size: stats.size,
		modifiedAt: stats.mtimeMs,
	};
}

export async function listFilesystemFilesRecursive(rootPath: string): Promise<FsFileRef[]> {
	if (isSshProjectUri(rootPath)) {
		return listRemoteFilesRecursive(rootPath, {
			ignoredDirectoryNames: [...RECURSIVE_IGNORED_DIRS],
			limit: MAX_RECURSIVE_FILES,
		});
	}
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
				if (isConversationWorkspaceDirEntry(dir, entry.name)) continue;
				await walk(fullPath);
			} else if (entry.isFile()) {
				results.push({ name: entry.name, path: fullPath, relPath: relative(root, fullPath) });
			}
		}
	}
	await walk(root);
	return results;
}
