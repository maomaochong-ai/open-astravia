import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type ConversationAgentAuthorReference,
	type ConversationAgentMessageRecord,
	type ConversationUserAuthorReference,
	type ConversationUserMessageRecord,
	isConversationMessageRecord,
} from "../../src/conversation/index.js";

describe("Conversation message contract", () => {
	it("exports reusable user and Agent author references", () => {
		expectTypeOf<ConversationUserMessageRecord["author"]>().toEqualTypeOf<ConversationUserAuthorReference>();
		expectTypeOf<ConversationAgentMessageRecord["author"]>().toEqualTypeOf<ConversationAgentAuthorReference>();
	});

	it("accepts role-consistent user and Agent records", () => {
		expect(
			isConversationMessageRecord({
				kind: "user",
				id: "message-user",
				turnId: "turn-1",
				timestamp: 1,
				author: { kind: "user", id: "local-user" },
				message: { role: "user", content: "hello", timestamp: 1 },
				attachments: [{ kind: "file", path: "C:/workspace/file.ts" }],
			}),
		).toBe(true);
		expect(
			isConversationMessageRecord({
				kind: "agent",
				id: "message-agent",
				turnId: "turn-1",
				timestamp: 2,
				author: { kind: "agent", id: "reviewer", agentId: "profile-reviewer" },
				message: {
					role: "assistant",
					content: [{ type: "text", text: "done" }],
					api: "openai-responses",
					provider: "openai",
					model: "model",
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
					stopReason: "stop",
					timestamp: 2,
				},
			}),
		).toBe(true);
	});

	it("rejects crossed roles and Agent attachments", () => {
		const base = { id: "message", turnId: "turn", timestamp: 1 };
		expect(
			isConversationMessageRecord({
				...base,
				kind: "user",
				author: { kind: "agent", id: "agent" },
				message: { role: "user", content: "hello", timestamp: 1 },
			}),
		).toBe(false);
		expect(
			isConversationMessageRecord({
				...base,
				kind: "agent",
				author: { kind: "agent", id: "agent" },
				message: { role: "user", content: "hello", timestamp: 1 },
			}),
		).toBe(false);
		expect(
			isConversationMessageRecord({
				...base,
				kind: "agent",
				author: { kind: "agent", id: "agent" },
				message: { role: "assistant" },
				attachments: [],
			}),
		).toBe(false);
	});
});
