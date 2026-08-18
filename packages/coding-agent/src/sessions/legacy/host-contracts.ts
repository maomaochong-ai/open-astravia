import type { LegacySessionImportEntryNormalizer } from "@vetta/runtime-storage/conversation";

export interface LegacySessionFormatLeaseHolder {
	readonly pid: number;
	readonly hostname: string;
	readonly openedAt: string;
	readonly processStartedAt?: string;
}

export interface LegacySessionFormatLease {
	readonly lockPath: string;
	release(): void;
}

export type LegacySessionFormatLeaseResult =
	| { readonly kind: "acquired"; readonly lease: LegacySessionFormatLease }
	| {
			readonly kind: "locked";
			readonly lockPath: string;
			readonly holder: LegacySessionFormatLeaseHolder;
	  };

export interface LegacySessionDirectoryEntry {
	readonly name: string;
	readonly kind: "file" | "directory" | "other";
}

/** Node-free file operations needed by the read-only Legacy session catalog and history projection. */
export interface LegacySessionFileHost {
	readonly sessionsDirectory: string;
	readonly defaultCwd: string;
	join(...parts: readonly string[]): string;
	exists(path: string): boolean;
	readText(path: string): string;
	readFirstLine(path: string): Promise<string | undefined>;
	readFirstLineSync(path: string): string | undefined;
	readDirectory(path: string): Promise<readonly LegacySessionDirectoryEntry[]>;
	statModifiedAt(path: string): Promise<number>;
	appendText(path: string, content: string): Promise<void>;
	remove(path: string): Promise<void>;
	createRandomId(): string;
	acquireLease(path: string): LegacySessionFormatLeaseResult;
}

/** Environment implementation used by the Coding Agent migration policy. */
export interface LegacySessionMigrationHost {
	canonicalize(path: string): Promise<string>;
	readBytes(path: string): Promise<Uint8Array>;
	digest(parts: readonly [string, Uint8Array]): string;
	acquireLease(path: string): LegacySessionFormatLeaseResult;
	migrate(options: {
		readonly sourcePath: string;
		readonly targetRootDir: string;
		readonly targetSessionId: string;
		readonly reuseIdenticalTarget: boolean;
		readonly entryNormalizer: LegacySessionImportEntryNormalizer;
	}): Promise<{
		readonly targetPath: string;
		readonly targetSessionId: string;
		readonly created: boolean;
	}>;
}
