import { createConversationAgentMessage, createConversationUserMessage } from "@shared/conversation";
import { describe, expect, it } from "vitest";
import { collectAgentUsages, collectModelSwitchLabels, userModelSwitchFingerprint } from "./message-list-derived";

describe("message-list-derived", () => {
	it("keeps the model-switch fingerprint stable while only the assistant tail grows", () => {
		const user = createConversationUserMessage({
			id: "u1",
			text: "hi",
			model: { provider: "openai", id: "gpt-5" },
		});
		const firstTail = createConversationAgentMessage({ id: "a1", text: "hel", blocks: [] });
		const nextTail = createConversationAgentMessage({ id: "a1", text: "hello", blocks: [] });
		const names = new Map([["openai/gpt-5", "GPT-5"]]);

		expect(userModelSwitchFingerprint([user, firstTail])).toBe(userModelSwitchFingerprint([user, nextTail]));
		expect(collectModelSwitchLabels([user, firstTail], names).size).toBe(0);
	});

	it("records both model names on the user message that changed models", () => {
		const first = createConversationUserMessage({
			id: "u1",
			text: "a",
			model: { provider: "openai", id: "gpt-4" },
		});
		const second = createConversationUserMessage({
			id: "u2",
			text: "b",
			model: { provider: "openai", id: "gpt-5" },
		});
		const labels = collectModelSwitchLabels(
			[first, second],
			new Map([
				["openai/gpt-4", "GPT-4"],
				["openai/gpt-5", "GPT-5"],
			]),
		);
		expect(labels.get("u2")).toEqual({ from: "GPT-4", to: "GPT-5" });
		expect(labels.has("u1")).toBe(false);
	});

	it("uses the last known model across missing history and falls back to model keys", () => {
		const messages = [
			createConversationUserMessage({ id: "u1", text: "a", model: { provider: "openai", id: "gpt-4" } }),
			createConversationUserMessage({ id: "u2", text: "b" }),
			createConversationUserMessage({ id: "u3", text: "c", model: { provider: "openai", id: "gpt-4" } }),
			createConversationUserMessage({ id: "u4", text: "d", model: { provider: "other", id: "new" } }),
		];
		const labels = collectModelSwitchLabels(messages, new Map([["openai/gpt-4", "GPT-4"]]));
		expect([...labels]).toEqual([["u4", { from: "GPT-4", to: "other/new" }]]);
	});

	it("collects agent usages in transcript order", () => {
		const usages = collectAgentUsages([
			createConversationUserMessage({ id: "u1", text: "q" }),
			createConversationAgentMessage({
				id: "a1",
				text: "a",
				blocks: [],
				usages: [
					{
						input: 1,
						output: 2,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 3,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				],
			}),
		]);
		expect(usages).toHaveLength(1);
		expect(usages[0]?.output).toBe(2);
	});
});
