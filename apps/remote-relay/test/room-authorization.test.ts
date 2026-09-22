import { describe, expect, it } from "vitest";
import { RoomAuthorization } from "../src/room-authorization.js";

function fakeState(initial: Readonly<Record<string, unknown>> = {}) {
	const values = new Map<string, unknown>(Object.entries(initial));
	return {
		storage: {
			get: async <T>(key: string) => values.get(key) as T | undefined,
			put: async (key: string, value: unknown) => void values.set(key, value),
			delete: async (key: string) => void values.delete(key),
		},
		blockConcurrencyWhile: async (callback: () => Promise<void>) => callback(),
	};
}

describe("RoomAuthorization", () => {
	it("lets only a desktop carrying the phone hash claim a fresh room", async () => {
		const auth = new RoomAuthorization(fakeState() as never);
		expect(await auth.authorizeMobile("mobile-hash")).toBe(false);
		expect(await auth.authorizeDesktop("desktop-hash")).toBe(false);
		expect(await auth.authorizeDesktop("desktop-hash", "mobile-hash")).toBe(true);
		expect(await auth.authorizeMobile("mobile-hash")).toBe(true);
		expect(await auth.authorizeMobile("desktop-hash")).toBe(false);
	});

	it("rejects a different desktop and lets the registered one rotate the phone hash", async () => {
		const auth = new RoomAuthorization(fakeState() as never);
		expect(await auth.authorizeDesktop("desktop-hash", "mobile-hash")).toBe(true);
		expect(await auth.authorizeDesktop("other-desktop", "mobile-hash-2")).toBe(false);
		expect(await auth.authorizeMobile("mobile-hash")).toBe(true);
		expect(await auth.authorizeDesktop("desktop-hash")).toBe(true);
		expect(await auth.authorizeMobile("mobile-hash")).toBe(true);
		expect(await auth.authorizeDesktop("desktop-hash", "mobile-hash-2")).toBe(true);
		expect(await auth.authorizeMobile("mobile-hash")).toBe(false);
		expect(await auth.authorizeMobile("mobile-hash-2")).toBe(true);
	});
});
