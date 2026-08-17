import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type NodeResourceEntryKind = "file" | "directory" | "other";

export interface NodeResourceFileInfo {
	readonly kind: NodeResourceEntryKind;
	readonly modifiedAtMs: number;
	readonly size: number;
}

export interface NodeResourceDirectoryEntry {
	readonly name: string;
	readonly kind: NodeResourceEntryKind;
	readonly symbolicLink: boolean;
}

export interface NodeResourceAccessOptions {
	readonly signal?: AbortSignal;
}

export interface NodeResourceAccess {
	readonly files: {
		stat(resourcePath: string, options?: NodeResourceAccessOptions): Promise<NodeResourceFileInfo | undefined>;
		readText(resourcePath: string, options?: NodeResourceAccessOptions): Promise<string>;
		readDirectory(
			resourcePath: string,
			options?: NodeResourceAccessOptions,
		): Promise<readonly NodeResourceDirectoryEntry[]>;
		realPath(resourcePath: string, options?: NodeResourceAccessOptions): Promise<string>;
	};
	readonly paths: {
		readonly separator: string;
		homeDirectory(): string;
		basename(resourcePath: string): string;
		dirname(resourcePath: string): string;
		isAbsolute(resourcePath: string): boolean;
		join(...parts: readonly string[]): string;
		relative(from: string, to: string): string;
		resolve(...parts: readonly string[]): string;
	};
}

function entryKind(entry: { isFile(): boolean; isDirectory(): boolean }): NodeResourceEntryKind {
	if (entry.isFile()) return "file";
	if (entry.isDirectory()) return "directory";
	return "other";
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}

/** Generic Node adapter for portable resource discovery contracts. */
export function createNodeResourceAccess(): NodeResourceAccess {
	return {
		files: {
			async stat(resourcePath, options) {
				options?.signal?.throwIfAborted();
				try {
					const info = await stat(resourcePath);
					options?.signal?.throwIfAborted();
					return { kind: entryKind(info), modifiedAtMs: info.mtimeMs, size: info.size };
				} catch (error) {
					if (isMissingFileError(error)) return undefined;
					throw error;
				}
			},
			readText: (resourcePath, options) => readFile(resourcePath, { encoding: "utf8", signal: options?.signal }),
			async readDirectory(resourcePath, options) {
				options?.signal?.throwIfAborted();
				const entries = await readdir(resourcePath, { withFileTypes: true });
				options?.signal?.throwIfAborted();
				return entries.map((entry) => ({
					name: entry.name,
					kind: entryKind(entry),
					symbolicLink: entry.isSymbolicLink(),
				}));
			},
			async realPath(resourcePath, options) {
				options?.signal?.throwIfAborted();
				const resolved = await realpath(resourcePath);
				options?.signal?.throwIfAborted();
				return resolved;
			},
		},
		paths: {
			separator: path.sep,
			homeDirectory: homedir,
			basename: path.basename,
			dirname: path.dirname,
			isAbsolute: path.isAbsolute,
			join: (...parts) => path.join(...parts),
			relative: path.relative,
			resolve: (...parts) => path.resolve(...parts),
		},
	};
}
