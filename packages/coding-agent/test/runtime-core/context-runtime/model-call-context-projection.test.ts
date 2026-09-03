import type { Api, AssistantMessage, Message, Model, UserMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { projectModelCallContext } from "../../../src/compaction/runtime/model-call-context-projection.js";

describe("model call context projection", () => {
	it("omits only published text while keeping the original private tool call and result paired", async () => {
		const assistant: AssistantMessage = {
			role: "assistant",
			api: "openai-responses",
			provider: "test",
			model: "model",
			timestamp: 2,
			stopReason: "toolUse",
			usage: {
				input: 1,
				output: 1,
				totalTokens: 2,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			content: [
				{ type: "thinking", thinking: "private", thinkingSignature: "signature" },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "file" } },
				{ type: "text", text: "public answer" },
			],
		};
		const result: Message = {
			role: "toolResult",
			toolCallId: "tool-1",
			toolName: "read",
			isError: false,
			content: [{ type: "text", text: "private result" }],
			timestamp: 3,
		};
		const projected = await projectModelCallContext(
			{
				sessionId: "member",
				turnId: "turn",
				messages: [assistant, result],
				modelBinding: { model: MODEL },
				messageEnvelopes: [
					{ kind: "message", entryId: "published", message: assistant },
					{ kind: "message", entryId: "result", message: result },
				],
			},
			undefined,
			new AbortController().signal,
			{
				timeBoundary: 3,
				pinnedContext: {
					id: "generation",
					records: [{ type: "public", content: "public answer", modelVisible: true, timestamp: 2 }],
					conversationProjections: [{ entryId: "published", kind: "omit-assistant-text" }],
				},
			},
		);
		expect(projected.messages).toEqual([
			userMessage("public answer", 2),
			{ ...assistant, content: assistant.content.slice(0, 2) },
			result,
		]);
		expect(assistant.content).toHaveLength(3);
	});

	it("applies the extension transform while keeping model-invisible context out of the call", async () => {
		const visible = userMessage("visible", 1);
		const projected = await projectModelCallContext(
			{
				sessionId: "session-1",
				turnId: "turn-1",
				messages: [visible],
				messageEnvelopes: [
					{ kind: "message", message: visible },
					{
						kind: "context",
						record: { type: "hidden", content: "secret", modelVisible: false },
						timestamp: 2,
					},
				],
				modelBinding: { model: MODEL },
			},
			async (messages) =>
				messages.map((message) => (message.role === "user" ? { ...message, content: "transformed" } : message)),
			new AbortController().signal,
		);

		expect(projected.messages.map(messageText)).toEqual(["transformed"]);
		expect(projected.estimatedTokens).toBeGreaterThan(0);
	});

	it("honors cancellation that occurs during the extension transform", async () => {
		const controller = new AbortController();
		await expect(
			projectModelCallContext(
				{
					sessionId: "session-1",
					turnId: "turn-1",
					messages: [userMessage("visible", 1)],
					modelBinding: { model: MODEL },
				},
				async (messages) => {
					controller.abort();
					return messages;
				},
				controller.signal,
			),
		).rejects.toThrow();
	});

	it("pins one immutable shared prefix ahead of private history and removes an older copy", async () => {
		const shared = userMessage("shared", 10);
		const projected = await projectModelCallContext(
			{
				sessionId: "member-session",
				turnId: "turn-1",
				messages: [shared, userMessage("private", 20), userMessage("current", 30)],
				messageEnvelopes: [
					{ kind: "message", entryId: "old-import", message: shared },
					{ kind: "message", entryId: "private", message: userMessage("private", 20) },
					{ kind: "message", message: userMessage("current", 30) },
				],
				modelBinding: { model: MODEL },
			},
			undefined,
			new AbortController().signal,
			{
				pinnedContext: {
					id: "team-generation-1",
					conversationProjections: [{ entryId: "old-import", kind: "omit-entry" }],
					records: [{ type: "team.public", content: "shared", modelVisible: true, timestamp: 10 }],
				},
			},
		);

		expect(projected.messages.map(messageText)).toEqual(["shared", "private", "current"]);
	});

	it("preserves an identical direct user message rather than guessing duplicate content", async () => {
		const projected = await projectModelCallContext(
			{ sessionId: "member", turnId: "turn", messages: [userMessage("shared", 10)], modelBinding: { model: MODEL } },
			undefined,
			new AbortController().signal,
			{
				pinnedContext: {
					id: "generation",
					records: [{ type: "public", content: "shared", timestamp: 10, modelVisible: true }],
				},
			},
		);
		expect(projected.messages.map(messageText)).toEqual(["shared", "shared"]);
	});
});

function userMessage(text: string, timestamp: number): UserMessage {
	return { role: "user", content: text, timestamp };
}

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((item): item is Extract<(typeof message.content)[number], { type: "text" }> => item.type === "text")
		.map(({ text }) => text)
		.join("");
}

const MODEL: Model<Api> = {
	id: "model",
	name: "Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100,
	maxTokens: 20,
};
