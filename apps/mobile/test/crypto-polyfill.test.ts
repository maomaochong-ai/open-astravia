import { randomFillSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installCryptoPolyfill } from "../src/remote/platform/crypto-polyfill";

vi.mock("expo-crypto", () => ({
	getRandomValues: (array: Uint8Array) => randomFillSync(array),
	randomUUID: () => randomUUID(),
}));

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("crypto polyfill", () => {
	it("backs globalThis.crypto with expo-crypto when the runtime has no WebCrypto", () => {
		vi.stubGlobal("crypto", undefined);

		installCryptoPolyfill();

		const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
		expect(bytes.some((b) => b !== 0)).toBe(true);
		expect(globalThis.crypto.randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
	});

	// @noble/* captures globalThis.crypto while being evaluated, so the polyfill must
	// load before expo-router pulls in any route that reaches @vetta/remote-control.
	it("is installed by the app entry before expo-router loads", () => {
		const root = join(__dirname, "..");
		const { main } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { main: string };
		const imports = [...readFileSync(join(root, main), "utf8").matchAll(/^import\s+"([^"]+)";/gm)].map((m) => m[1]);

		expect(imports[0]).toBe("./src/remote/platform/install-crypto-polyfill");
		expect(imports).toContain("expo-router/entry");
	});
});
