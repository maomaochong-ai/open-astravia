import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "../../config.js";
import type { AuthStorageBackend, AuthStorageTransaction } from "../contracts.js";

export class FileAuthStorageBackend implements AuthStorageBackend {
	constructor(private readonly authPath: string = join(getAgentDir(), "auth.json")) {}

	withLock<T>(operation: (current: string | undefined) => AuthStorageTransaction<T>): T {
		this.ensureStorage();
		let release: (() => void) | undefined;
		try {
			release = lockfile.lockSync(this.authPath, { realpath: false });
			const current = existsSync(this.authPath) ? readFileSync(this.authPath, "utf-8") : undefined;
			const { result, next } = operation(current);
			if (next !== undefined) this.write(next);
			return result;
		} finally {
			release?.();
		}
	}

	async withLockAsync<T>(operation: (current: string | undefined) => Promise<AuthStorageTransaction<T>>): Promise<T> {
		this.ensureStorage();
		let release: (() => Promise<void>) | undefined;
		let compromisedError: Error | undefined;
		const throwIfCompromised = () => {
			if (compromisedError) throw compromisedError;
		};

		try {
			release = await lockfile.lock(this.authPath, {
				retries: { retries: 10, factor: 2, minTimeout: 100, maxTimeout: 10000, randomize: true },
				stale: 30000,
				onCompromised: (error) => {
					compromisedError = error;
				},
			});
			throwIfCompromised();
			const current = existsSync(this.authPath) ? readFileSync(this.authPath, "utf-8") : undefined;
			const { result, next } = await operation(current);
			throwIfCompromised();
			if (next !== undefined) this.write(next);
			throwIfCompromised();
			return result;
		} finally {
			if (release) {
				try {
					await release();
				} catch {
					// 锁已损坏时忽略解锁错误，保留原始 compromised 错误语义。
				}
			}
		}
	}

	private ensureStorage(): void {
		const directory = dirname(this.authPath);
		if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
		if (!existsSync(this.authPath)) this.write("{}");
	}

	private write(content: string): void {
		writeFileSync(this.authPath, content, "utf-8");
		chmodSync(this.authPath, 0o600);
	}
}
