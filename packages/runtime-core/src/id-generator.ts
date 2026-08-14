/** Generate an identifier using the platform-standard Web Crypto contract. */
export function createRuntimeId(): string {
	return globalThis.crypto.randomUUID();
}
