import type { AuthStorageBackend, AuthStorageTransaction } from "../contracts.js";

export class InMemoryAuthStorageBackend implements AuthStorageBackend {
	private value: string | undefined;

	withLock<T>(operation: (current: string | undefined) => AuthStorageTransaction<T>): T {
		const { result, next } = operation(this.value);
		if (next !== undefined) this.value = next;
		return result;
	}

	async withLockAsync<T>(operation: (current: string | undefined) => Promise<AuthStorageTransaction<T>>): Promise<T> {
		const { result, next } = await operation(this.value);
		if (next !== undefined) this.value = next;
		return result;
	}
}
