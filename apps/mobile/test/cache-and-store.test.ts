import type { RemoteSessionSummary } from "@vetta/remote-control";
import { describe, expect, it } from "vitest";
import { MemorySessionCache, SESSION_CACHE_LIMIT } from "../src/remote/cache";
import { MemoryKeyValueStore, PairingStore } from "../src/remote/pairing-store";

function session(id: number): RemoteSessionSummary {
	return {
		id: `s${id}`,
		projectCwd: "/conv",
		projectName: "对话",
		title: `会话 ${id}`,
		updatedAt: id,
		status: "idle",
		live: false,
	};
}

describe("MemorySessionCache", () => {
	it("keeps only the 50 most recent sessions and drops their transcripts with them", async () => {
		const cache = new MemorySessionCache();
		const sessions = Array.from({ length: 60 }, (_, index) => session(index + 1));
		await cache.saveSessions("d1", sessions.slice(0, 10));
		await cache.saveTranscript("d1", "s1", [{ kind: "user", id: "u", text: "hi" }]);
		expect(await cache.loadTranscript("d1", "s1")).toHaveLength(1);
		await cache.saveSessions("d1", sessions);
		const kept = await cache.loadSessions("d1");
		expect(kept).toHaveLength(SESSION_CACHE_LIMIT);
		expect(kept[0]?.id).toBe("s60");
		expect(kept.some((entry) => entry.id === "s1")).toBe(false);
		expect(await cache.loadTranscript("d1", "s1")).toBeUndefined();
	});

	it("ignores transcripts for unknown sessions and clears per desktop", async () => {
		const cache = new MemorySessionCache();
		await cache.saveTranscript("d1", "ghost", []);
		expect(await cache.loadTranscript("d1", "ghost")).toBeUndefined();
		await cache.saveSessions("d1", [session(1)]);
		await cache.saveSessions("d2", [session(2)]);
		await cache.clearDesktop("d1");
		expect(await cache.loadSessions("d1")).toEqual([]);
		expect(await cache.loadSessions("d2")).toHaveLength(1);
	});
});

describe("PairingStore", () => {
	it("generates one identity, persists desktops with secrets apart, and revokes cleanly", async () => {
		const settings = new MemoryKeyValueStore();
		const secrets = new MemoryKeyValueStore();
		const store = new PairingStore({ settings, secrets });
		await store.load();
		const identity = store.getIdentity();
		expect(store.hasCurrent()).toBe(false);

		await store.save({
			desktopIdentityKey: "k1",
			desktopName: "MacBook",
			pairingId: "p1",
			mobileSecret: "s1",
			lanEndpoints: ["a:1"],
			lastEventSequence: 0,
			pairedAt: 1,
			lastSeenAt: 1,
		});
		expect((await settings.get("vetta.desktops")) ?? "").not.toContain("s1");
		expect(await store.getCurrent()).toMatchObject({ desktopIdentityKey: "k1", mobileSecret: "s1" });

		await store.update("k1", { lastEventSequence: 7, lanEndpoints: ["b:2"] });
		const reloaded = new PairingStore({ settings, secrets });
		await reloaded.load();
		expect(reloaded.getIdentity().publicKey).toEqual(identity.publicKey);
		expect(await reloaded.getCurrent()).toMatchObject({ lastEventSequence: 7, lanEndpoints: ["b:2"] });

		await reloaded.revoke("k1");
		expect(reloaded.hasCurrent()).toBe(false);
		expect(await secrets.get("vetta.desktop.k1.secret")).toBeNull();
	});
});
