import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertOrdinaryConversationPath } from "./conversation-ownership-guard.js";

describe("assertOrdinaryConversationPath", () => {
	it("waits for discovery and normalizes an ordinary path", async () => {
		const ensureReady = vi.fn(async () => undefined);
		const getOwner = vi.fn(async () => undefined);

		await expect(
			assertOrdinaryConversationPath("C:/sessions/ordinary.jsonl", { ensureReady, getOwner }),
		).resolves.toBe(resolve("C:/sessions/ordinary.jsonl"));
		expect(ensureReady).toHaveBeenCalledOnce();
		expect(getOwner).toHaveBeenCalledWith(resolve("C:/sessions/ordinary.jsonl"));
	});

	it("rejects a Team-owned path", async () => {
		await expect(
			assertOrdinaryConversationPath("C:/sessions/member.jsonl", {
				ensureReady: async () => undefined,
				getOwner: async () => ({
					kind: "agent-team",
					teamId: "team",
					teamSessionId: "session",
					role: "member",
				}),
			}),
		).rejects.toThrow("Conversation is managed by Agent Team: team/session");
	});
});
