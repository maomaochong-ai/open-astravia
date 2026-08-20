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
	it("consumes bootstrap and binds a mobile resume credential exactly once", async () => {
		const auth = new RoomAuthorization(fakeState() as never);
		expect(await auth.authorizeDesktop("desktop-hash", "bootstrap-hash")).toBe(true);
		expect(await auth.authorizeMobile("bootstrap-hash")).toBe("bootstrap");
		expect(await auth.consumeBootstrap("resume-hash")).toBe(true);
		expect(await auth.authorizeMobile("bootstrap-hash")).toBe(false);
		expect(await auth.authorizeMobile("resume-hash")).toBe("resume");
		expect(await auth.consumeBootstrap("another-resume-hash")).toBe(false);
	});

	it("keeps a new desktop credential unusable as a mobile credential", async () => {
		const auth = new RoomAuthorization(fakeState() as never);
		expect(await auth.authorizeDesktop("desktop-hash", "bootstrap-hash")).toBe(true);
		expect(await auth.consumeBootstrap("resume-hash")).toBe(true);
		expect(await auth.authorizeMobile("desktop-hash")).toBe(false);
	});

	it("retains the legacy single-secret contract for old clients", async () => {
		const auth = new RoomAuthorization(fakeState() as never);
		expect(await auth.authorizeDesktop("legacy-hash")).toBe(true);
		expect(await auth.authorizeMobile("legacy-hash")).toBe("legacy");
	});

	it("migrates desktop-only rooms created before credential modes were introduced", async () => {
		const auth = new RoomAuthorization(fakeState({ desktopCredentialHash: "old-hash" }) as never);
		expect(await auth.authorizeMobile("old-hash")).toBe("legacy");
	});
});
