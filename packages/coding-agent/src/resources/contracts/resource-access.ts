export type ResourceEntryKind = "file" | "directory" | "other";

export interface ResourceFileInfo {
	readonly kind: ResourceEntryKind;
	readonly modifiedAtMs: number;
	readonly size: number;
}

export interface ResourceDirectoryEntry {
	readonly name: string;
	readonly kind: ResourceEntryKind;
	readonly symbolicLink: boolean;
}

export interface ResourceAccessOptions {
	readonly signal?: AbortSignal;
}

/** Host-provided asynchronous access to resource content and metadata. */
export interface ResourceFileTreePort {
	stat(path: string, options?: ResourceAccessOptions): Promise<ResourceFileInfo | undefined>;
	readText(path: string, options?: ResourceAccessOptions): Promise<string>;
	readDirectory(path: string, options?: ResourceAccessOptions): Promise<readonly ResourceDirectoryEntry[]>;
	realPath(path: string, options?: ResourceAccessOptions): Promise<string>;
}

/** Path semantics are host-owned so resource discovery is not tied to Node paths. */
export interface ResourcePathPort {
	readonly separator: string;
	homeDirectory(): string;
	basename(path: string): string;
	dirname(path: string): string;
	isAbsolute(path: string): boolean;
	join(...parts: readonly string[]): string;
	relative(from: string, to: string): string;
	resolve(...parts: readonly string[]): string;
}

export interface ResourceAccessPort {
	readonly files: ResourceFileTreePort;
	readonly paths: ResourcePathPort;
}
