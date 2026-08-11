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

/**
 * Private persistent storage scoped to the current plugin.
 *
 * JSON keys and file paths are relative to the plugin namespace. Blob bytes are
 * base64 encoded at the bridge boundary and exposed through a host media URL.
 */
export interface PluginStorageApi {
	readJson<T>(key: string): Promise<T | null>;
	writeJson(key: string, value: unknown): Promise<void>;
	list(prefix?: string): Promise<string[]>;
	readFile(path: string): Promise<string | null>;
	writeFile(path: string, data: string): Promise<void>;
	putBlob(input: PluginPutBlobInput): Promise<PluginStoredBlobRef>;
	/** Copy a user-selected or dropped filesystem file without carrying its bytes through the renderer. */
	putBlobFromFile(input: PluginPutBlobFromFileInput): Promise<PluginStoredBlobRef>;
	readBlob(id: string): Promise<PluginStoredBlob | null>;
	getBlobRef(id: string): Promise<PluginStoredBlobRef | null>;
}
