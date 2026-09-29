export interface PluginFsEntry {
	name: string;
	path: string;
	isDirectory: boolean;
	size: number;
	modifiedAt: number;
}

export interface PluginFsFileRef {
	name: string;
	path: string;
	relPath: string;
}

export interface PluginFsStatResult {
	size: number;
	modifiedAt: number;
	createdAt: number;
}

export interface PluginFsReadResult {
	content: string;
	encoding: "utf8" | "base64";
}

export interface PluginFsBinaryReadResult {
	data: string;
	mimeType: string;
	size: number;
}

export interface PluginFsSaveAsOptions {
	title?: string;
	/** Defaults to a single filter derived from the default file name's extension. */
	filters?: Array<{ name: string; extensions: string[] }>;
}

export interface PluginFsListFilesRecursiveOptions {
	/**
	 * Only return files whose base name is one of these (exact match, e.g.
	 * `["package.json", "Makefile"]`). The host's result cap counts matches, so a
	 * manifest scan in a large monorepo is not truncated by unrelated files.
	 * Hosts older than Plugin API 2.8.0 ignore this and return every file — filter
	 * the result yourself if you also target them.
	 */
	names?: readonly string[];
	/** Extra directory names to skip, on top of the host defaults (`node_modules`, `.git`, `dist`, …). */
	ignoredDirectories?: readonly string[];
}

export interface PluginFsApi {
	readDir(dirPath: string): Promise<PluginFsEntry[]>;
	readFile(filePath: string): Promise<PluginFsReadResult>;
	readBinaryFile(filePath: string): Promise<PluginFsBinaryReadResult>;
	/** Pass `encoding: "base64"` to write binary payloads (decoded from base64 text). */
	writeFile(filePath: string, content: string, encoding?: "utf8" | "base64"): Promise<void>;
	stat(filePath: string): Promise<PluginFsStatResult | null>;
	rename(oldPath: string, newPath: string): Promise<void>;
	delete(targetPath: string): Promise<void>;
	move(sourcePath: string, destDir: string): Promise<void>;
	createDirectory(dirPath: string): Promise<void>;
	/**
	 * Every regular file under `rootPath`, skipping dot-entries and the host's
	 * ignored directories. Capped at 10,000 results.
	 */
	listFilesRecursive(rootPath: string, options?: PluginFsListFilesRecursiveOptions): Promise<PluginFsFileRef[]>;
	/**
	 * Write bytes to a path the user picks in the host's native save dialog.
	 * Unlike {@link writeFile} the destination is not restricted to project
	 * roots — the user chooses it, so nothing lands on disk without an explicit
	 * confirmation. Resolves to the saved path, or `null` if the user cancels.
	 * Requires `fs.write`.
	 */
	saveAs(
		defaultFileName: string,
		content: string,
		encoding?: "utf8" | "base64",
		options?: PluginFsSaveAsOptions,
	): Promise<string | null>;
	/** Watch one directory for host-debounced changes. Requires `fs.read`. */
	watchDirectory(dirPath: string, listener: (changedPath: string) => void): Disposable;
}
import type { Disposable } from "./disposable.js";
