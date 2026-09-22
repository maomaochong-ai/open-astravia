import * as ExpoCrypto from "expo-crypto";

/**
 * `@noble/*` draws randomness from `globalThis.crypto.getRandomValues`. Hermes
 * does not ship WebCrypto, so back it with expo-crypto before any key is made.
 */
export function installCryptoPolyfill(): void {
	const scope = globalThis as { crypto?: { getRandomValues?: unknown; randomUUID?: unknown } };
	if (typeof scope.crypto?.getRandomValues === "function") return;
	const polyfill = {
		...(scope.crypto ?? {}),
		getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
			if (array === null) return array;
			return ExpoCrypto.getRandomValues(array as unknown as Uint8Array) as unknown as T;
		},
		randomUUID: () => ExpoCrypto.randomUUID(),
	};
	Object.defineProperty(scope, "crypto", { value: polyfill, configurable: true, writable: true });
}
