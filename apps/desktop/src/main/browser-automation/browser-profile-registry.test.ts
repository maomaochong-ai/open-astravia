import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserProfileRegistry } from "./browser-profile-registry.js";

const directories: string[] = [];

afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("BrowserProfileRegistry legacy migration", () => {
	it("copies the old Browser plugin login profile into the host-owned default profile", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-browser-profile-test-"));
		directories.push(root);
		const legacy = join(root, "legacy");
		await mkdir(legacy, { recursive: true });
		await writeFile(join(legacy, "cookie-state"), "signed-in", "utf8");
		const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const registry = new BrowserProfileRegistry({
			baseDirectory: join(root, "new"),
			legacyBrowserPluginProfile: legacy,
			logger,
		});
		const resources = await registry.prepareSession({
			namespace: "browser",
			sessionId: "session-1",
			source: "managed",
			profile: { type: "persistent", id: "default" },
			headed: true,
		});
		expect(await readFile(join(resources.profilePath!, "cookie-state"), "utf8")).toBe("signed-in");
		expect(logger.info).toHaveBeenCalledWith(
			"browser legacy profile migrated",
			expect.objectContaining({ namespace: "browser" }),
		);
	});

	it("never overwrites an existing target profile", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-browser-profile-test-"));
		directories.push(root);
		const legacy = join(root, "legacy");
		await mkdir(legacy, { recursive: true });
		await writeFile(join(legacy, "state"), "legacy", "utf8");
		const registry = new BrowserProfileRegistry({
			baseDirectory: join(root, "new"),
			legacyBrowserPluginProfile: legacy,
		});
		const first = await registry.prepareSession({
			namespace: "browser",
			sessionId: "session-1",
			source: "managed",
			profile: { type: "persistent", id: "default" },
			headed: true,
		});
		await writeFile(join(first.profilePath!, "state"), "current", "utf8");
		await registry.prepareSession({
			namespace: "browser",
			sessionId: "session-2",
			source: "managed",
			profile: { type: "persistent", id: "default" },
			headed: true,
		});
		expect(await readFile(join(first.profilePath!, "state"), "utf8")).toBe("current");
	});

	it("lists only host sessions that reference the requested persistent profile", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-browser-profile-test-"));
		directories.push(root);
		const registry = new BrowserProfileRegistry({ baseDirectory: root });
		const matchingId = "vetta-11111111-1111-4111-8111-111111111111";
		const otherId = "vetta-22222222-2222-4222-8222-222222222222";
		await registry.prepareSession({
			namespace: "browser",
			sessionId: matchingId,
			source: "managed",
			profile: { type: "persistent", id: "brand-a" },
			headed: true,
		});
		await registry.prepareSession({
			namespace: "browser",
			sessionId: otherId,
			source: "managed",
			profile: { type: "persistent", id: "brand-b" },
			headed: true,
		});

		const sessions = await registry.listPersistentProfileSessions({ namespace: "browser", profileId: "brand-a" });

		expect(sessions.map(({ sessionId }) => sessionId)).toEqual([matchingId]);
	});
});
