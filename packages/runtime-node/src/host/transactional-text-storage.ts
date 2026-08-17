import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";

export interface TextStorageTransaction<T> {
	readonly result: T;
	readonly next?: string;
}

export interface NodeTransactionalTextStorageOptions {
	readonly initialContent?: string;
	readonly directoryMode?: number;
	readonly fileMode?: number;
}

/** Single-file transactional text storage with synchronous and asynchronous locks. */
export class NodeTransactionalTextStorage {
	private readonly initialContent: string;
	private readonly directoryMode: number;
	private readonly fileMode: number;

	constructor(
		private readonly path: string,
		options: NodeTransactionalTextStorageOptions = {},
	) {
		this.initialContent = options.initialContent ?? "{}";
		this.directoryMode = options.directoryMode ?? 0o700;
		this.fileMode = options.fileMode ?? 0o600;
	}

	withLock<T>(operation: (current: string | undefined) => TextStorageTransaction<T>): T {
		this.ensureStorage();
		let release: (() => void) | undefined;
		try {
			release = lockfile.lockSync(this.path, { realpath: false });
			const { result, next } = operation(this.read());
			if (next !== undefined) this.write(next);
			return result;
		} finally {
			release?.();
		}
	}

	async withLockAsync<T>(operation: (current: string | undefined) => Promise<TextStorageTransaction<T>>): Promise<T> {
		this.ensureStorage();
		let release: (() => Promise<void>) | undefined;
		let compromisedError: Error | undefined;
		const throwIfCompromised = () => {
			if (compromisedError) throw compromisedError;
		};
		try {
			release = await lockfile.lock(this.path, {
				retries: { retries: 10, factor: 2, minTimeout: 100, maxTimeout: 10_000, randomize: true },
				stale: 30_000,
				onCompromised: (error) => {
					compromisedError = error;
				},
			});
			throwIfCompromised();
			const { result, next } = await operation(this.read());
			throwIfCompromised();
			if (next !== undefined) this.write(next);
			throwIfCompromised();
			return result;
		} finally {
			if (release) {
				try {
					await release();
				} catch {
					// Preserve a compromised lock error instead of replacing it with unlock failure.
				}
			}
		}
	}

	private ensureStorage(): void {
		const directory = dirname(this.path);
		if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: this.directoryMode });
		if (!existsSync(this.path)) this.write(this.initialContent);
	}

	private read(): string | undefined {
		return existsSync(this.path) ? readFileSync(this.path, "utf-8") : undefined;
	}

	private write(content: string): void {
		writeFileSync(this.path, content, "utf-8");
		chmodSync(this.path, this.fileMode);
	}
}
