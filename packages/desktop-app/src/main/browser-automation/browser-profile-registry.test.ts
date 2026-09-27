import { existsSync, rm } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserProfileRegistry } from "./browser-profile-registry.js";

const registry = new BrowserProfileRegistry();

const ROOT = `${process.env.HOME}/.astravia/browser-automation`;

afterEach(async () => {
	try {
		await new Promise<void>((resolve, reject) =>
			rm(ROOT, { recursive: true, force: true }, (e) => (e ? reject(e) : resolve())),
		);
	} catch {
		// ignore
	}
});

describe("BrowserProfileRegistry", () => {
	it("allocates distinct paths for two ephemeral sessions", async () => {
		const a = await registry.prepareSession({
			namespace: "ns",
			sessionId: "s1",
			source: "managed",
			profile: { type: "ephemeral" },
			headed: true,
		});
		const b = await registry.prepareSession({
			namespace: "ns",
			sessionId: "s2",
			source: "managed",
			profile: { type: "ephemeral" },
			headed: true,
		});
		expect(a.configPath).not.toBe(b.configPath);
		expect(existsSync(a.configPath)).toBe(true);
		expect(existsSync(b.configPath)).toBe(true);
	});

	it("ephemeral profileDir is cleaned up on release", async () => {
		const resources = await registry.prepareSession({
			namespace: "ns",
			sessionId: "s-ephemeral",
			source: "managed",
			profile: { type: "ephemeral" },
			headed: true,
		});
		const sessionDir = resources.profileDir!;
		expect(existsSync(sessionDir)).toBe(true);
		await registry.releaseSession(resources);
		expect(existsSync(sessionDir)).toBe(false);
	});

	it("persistent profile dir survives release", async () => {
		const resources = await registry.prepareSession({
			namespace: "ns",
			sessionId: "s-persist",
			source: "managed",
			profile: { type: "persistent", id: "my-google" },
			headed: true,
		});
		expect(resources.profileDir).toBeDefined();
		expect(resources.configPath).toContain("profiles");
		expect(existsSync(resources.configPath)).toBe(true);
		await registry.releaseSession(resources);
		// persistent profile 不清理
		expect(existsSync(resources.profileDir!)).toBe(true);
	});
});
