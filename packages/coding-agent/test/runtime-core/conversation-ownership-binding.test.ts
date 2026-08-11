import type { ConversationOwnershipLease, ConversationOwnershipManager } from "@vetta/runtime-storage/conversation";
import { describe, expect, it } from "vitest";
import { ConversationOwnershipBinding } from "../../src/composition/conversation-ownership-binding.js";

describe("ConversationOwnershipBinding", () => {
	it("acquires the rollover target before releasing the source", async () => {
		const events: string[] = [];
		const binding = await ConversationOwnershipBinding.acquire(manager(events), "source");

		await binding.rebind("target");
		await binding.dispose();

		expect(events).toEqual(["acquire:source", "acquire:target", "release:source", "release:target"]);
		expect(binding.conversationPath).toBe("target");
	});

	it("keeps source ownership when target acquisition fails", async () => {
		const events: string[] = [];
		const binding = await ConversationOwnershipBinding.acquire(manager(events, "target"), "source");

		await expect(binding.rebind("target")).rejects.toThrow("target unavailable");
		expect(binding.conversationPath).toBe("source");
		await binding.dispose();

		expect(events).toEqual(["acquire:source", "acquire:target", "release:source"]);
	});

	it("allows final runtime cleanup to retry a transient release failure", async () => {
		let releaseAttempts = 0;
		const binding = await ConversationOwnershipBinding.acquire(
			{
				acquire: async (conversationPath) => ({
					conversationPath,
					lockPath: `${conversationPath}.owner.lock`,
					holder: {
						token: conversationPath,
						pid: 1,
						hostname: "test",
						acquiredAt: new Date(0).toISOString(),
					},
					release: async () => {
						releaseAttempts++;
						if (releaseAttempts === 1) throw new Error("transient release failure");
					},
				}),
			},
			"source",
		);

		await expect(binding.dispose()).rejects.toThrow("transient release failure");
		await expect(binding.dispose()).resolves.toBeUndefined();
		expect(releaseAttempts).toBe(2);
	});
});

function manager(events: string[], rejectedPath?: string): ConversationOwnershipManager {
	return {
		async acquire(conversationPath) {
			events.push(`acquire:${conversationPath}`);
			if (conversationPath === rejectedPath) throw new Error(`${conversationPath} unavailable`);
			return lease(conversationPath, events);
		},
	};
}

function lease(conversationPath: string, events: string[]): ConversationOwnershipLease {
	let released = false;
	return {
		conversationPath,
		lockPath: `${conversationPath}.owner.lock`,
		holder: {
			token: conversationPath,
			pid: 1,
			hostname: "test",
			acquiredAt: new Date(0).toISOString(),
		},
		async release() {
			if (released) return;
			released = true;
			events.push(`release:${conversationPath}`);
		},
	};
}
