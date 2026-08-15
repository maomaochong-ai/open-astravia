import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { ConversationMessageSchema } from "../src/conversation/record-schema.js";

function assistantUsage(cacheUsageReporting?: "unavailable" | "read-only" | "read-write") {
	return {
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "openai",
		model: "test",
		usage: {
			input: 10,
			output: 2,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 12,
			...(cacheUsageReporting ? { cacheUsageReporting } : {}),
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

describe("conversation cache usage reporting", () => {
	it("accepts both historical records and the additive cache reporting field", () => {
		expect(Value.Check(ConversationMessageSchema, assistantUsage())).toBe(true);
		expect(Value.Check(ConversationMessageSchema, assistantUsage("read-only"))).toBe(true);
		expect(Value.Check(ConversationMessageSchema, assistantUsage("read-write"))).toBe(true);
	});

	it("rejects unknown cache reporting values", () => {
		const message = assistantUsage() as unknown as { usage: { cacheUsageReporting?: string } };
		message.usage.cacheUsageReporting = "maybe";
		expect(Value.Check(ConversationMessageSchema, message)).toBe(false);
	});

	it("persists optional privacy-safe prompt cache diagnostics", () => {
		const base = assistantUsage("read-write");
		const message = {
			...base,
			usage: {
				...base.usage,
				promptCache: {
					cachePrefixHash: "pc1:prefix",
					stableSystemPromptHash: "pc1:stable",
					volatileSystemPromptHash: "pc1:volatile",
					toolsHash: "pc1:tools",
					historyPrefixHash: "pc1:history",
					requestMessagesHash: "pc1:request-messages",
					requestMessageCount: 5,
					prefixStatus: "extended",
					changedSegments: ["volatile-system"],
					stableSystemPromptLength: 100,
					volatileSystemPromptLength: 20,
					historyPrefixMessages: 4,
					toolCount: 3,
				},
			},
		};

		expect(Value.Check(ConversationMessageSchema, message)).toBe(true);
	});
});
