export interface PluginStoredBlobRef {
	id: string;
	url: string;
	mimeType: string;
}

export interface PluginStoredBlob {
	data: string;
	mimeType: string;
}

export interface PluginPutBlobInput {
	id?: string;
	data: string;
	mimeType: string;
}

export interface PluginPutBlobFromFileInput {
	id?: string;
	file: File;
	mimeType: string;
}

export type PluginStorageEncoding = "utf8" | "base64";

export interface PluginStorageWrite {
	path: string;
	data: string;
	encoding: PluginStorageEncoding;
}

export type PluginStorageChange = ({ type: "write" } & PluginStorageWrite) | { type: "remove"; path: string };

export interface PluginStorageCommitOptions {
	expectedRevision?: string;
}

export interface PluginStorageCommitResult {
	revision: string;
	changedPaths: string[];
}

export interface PluginStorageSnapshot {
	revision: string;
	files: Record<string, string | null>;
}

/**
 * Private persistent storage scoped to the current plugin.
 *
 * Paths are relative to the plugin namespace and are never given an implicit
 * extension. Text and bytes use an explicit encoding at the bridge boundary;
 * JSON is a plugin-level serialization choice. `commit()` publishes all file
 * changes as one revision, and `readSnapshot()` reads several paths from the
 * same revision. Blob bytes remain a separate media resource API.
 */
export interface PluginStorageApi {
	list(prefix?: string): Promise<string[]>;
	readFile(path: string, encoding: PluginStorageEncoding): Promise<string | null>;
	writeFile(path: string, data: string, encoding: PluginStorageEncoding): Promise<PluginStorageCommitResult>;
	/** Atomically publish multiple private-file writes/removals as one plugin-scoped revision. */
	commit(
		changes: readonly PluginStorageChange[],
		options?: PluginStorageCommitOptions,
	): Promise<PluginStorageCommitResult>;
	/** Read several private files from one committed revision. */
	readSnapshot(paths: readonly string[], encoding: PluginStorageEncoding): Promise<PluginStorageSnapshot>;
	putBlob(input: PluginPutBlobInput): Promise<PluginStoredBlobRef>;
	/** Copy a user-selected or dropped filesystem file without carrying its bytes through the renderer. */
	putBlobFromFile(input: PluginPutBlobFromFileInput): Promise<PluginStoredBlobRef>;
	readBlob(id: string): Promise<PluginStoredBlob | null>;
	getBlobRef(id: string): Promise<PluginStoredBlobRef | null>;
}

/** Optional JSON convenience helpers. The storage contract itself remains file/bytes based. */
export async function readJsonFile<T>(storage: PluginStorageApi, path: string): Promise<T | null> {
	const data = await storage.readFile(path, "utf8");
	return data === null ? null : (JSON.parse(data) as T);
}

export function writeJsonFile(storage: PluginStorageApi, path: string, value: unknown): Promise<PluginStorageCommitResult> {
	return storage.writeFile(path, JSON.stringify(value, null, 2), "utf8");
}
