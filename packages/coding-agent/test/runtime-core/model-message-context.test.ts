import type { AssistantMessage, Message, UserMessage } from "@vetta/ai";
import {
	applyStoredEventToConversationDocument,
	createEmptyConversationDocument,
} from "@vetta/runtime-core/conversation";
import type { ModelCallMessageFinalizationInput } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import { CodingAgentModelCallMessageFinalizer } from "../../src/model-context/model-call-message-finalizer.js";
import { CodingAgentConversationContextProjector } from "../../src/sessions/projection/conversation-context-projector.js";

describe("Coding Agent model message context boundary", () => {
	it("projects standard, visible custom and model-invisible custom identities without flattening them", () => {
		let document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				message: userMessage("request", 1),
				timestamp: 1,
			},
			1,
		);
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "context.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				record: {
					type: "visible-context",
					content: "visible",
					modelVisible: true,
					display: true,
					metadata: { source: "test" },
				},
				timestamp: 2,
			},
			2,
		);
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "context.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				record: { type: "hidden-context", content: "hidden", modelVisible: false },
				timestamp: 3,
			},
			3,
		);

		const projected = new CodingAgentConversationContextProjector().project(document);

		expect(projected).toHaveLength(3);
		expect(projected[0]).toMatchObject({ kind: "message", message: { role: "user", content: "request" } });
		expect(projected[1]).toMatchObject({
			kind: "opaque",
			identity: {
				role: "custom",
				customType: "visible-context",
				content: "visible",
				display: true,
				details: { source: "test" },
			},
			modelMessage: { role: "user", content: [{ type: "text", text: "visible" }] },
		});
		expect(projected[2]).toMatchObject({
			kind: "opaque",
			identity: { role: "custom", customType: "hidden-context", content: "hidden" },
		});
		expect(projected[2]).not.toHaveProperty("modelMessage");
	});

	it("keeps images below the request watermark and applies dynamic block-images policy", async () => {
		let blocked = false;
		const finalizer = new CodingAgentModelCallMessageFinalizer({
			getImageAutoResize: () => false,
			getBlockImages: () => blocked,
		});
		const messages = [
			imageMessage("old-1", 1),
			imageMessage("old-2", 2),
			assistantMessage(3),
			imageMessage("new", 4),
		] satisfies Message[];

		const finalized = await finalizer.finalize(finalizationInput(messages), new AbortController().signal);
		expect(imageCount(finalized)).toBe(3);

		blocked = true;
		const withoutImages = await finalizer.finalize(finalizationInput(messages), new AbortController().signal);
		expect(imageCount(withoutImages)).toBe(0);
		expect(withoutImages.flatMap(texts)).toContain("Image reading is disabled.");
	});

	it("retains compaction identity when the stored summary and commit event have different timestamps", () => {
		let document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				message: userMessage("request", 1),
				timestamp: 1,
			},
			1,
		);
		document = applyStoredEventToConversationDocument(
			document,
			{
				type: "context.compacted",
				sessionId: "session-1",
				turnId: "turn-1",
				record: {
					summary: "summary",
					summaryMessage: userMessage(
						"The conversation history before this point was compacted into the following summary:\n\n<summary>\nsummary\n</summary>",
						4,
					),
					firstKeptEntryId: "event-1",
					tokensBefore: 10,
					reason: "threshold",
				},
				timestamp: 5,
			},
			2,
		);

		const projected = new CodingAgentConversationContextProjector().project(document);

		expect(projected[0]).toMatchObject({
			kind: "opaque",
			identity: { role: "compactionSummary", timestamp: 5 },
			modelMessage: { role: "user", timestamp: 4 },
		});
	});
});

function finalizationInput(messages: readonly Message[]): ModelCallMessageFinalizationInput {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		messages,
		modelBinding: {
			model: {
				id: "model",
				name: "Model",
				api: "openai-responses" as const,
				provider: "test",
				baseUrl: "https://example.test",
				reasoning: false,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100,
				maxTokens: 20,
			},
		},
	};
}

function userMessage(content: string, timestamp: number): UserMessage {
	return { role: "user", content, timestamp };
}

function imageMessage(data: string, timestamp: number): UserMessage {
	return { role: "user", content: [{ type: "image", data, mimeType: "image/png" }], timestamp };
}

function assistantMessage(timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "seen" }],
		api: "openai-responses",
		provider: "test",
		model: "model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

function imageCount(messages: readonly Message[]): number {
	return messages.reduce(
		(count, message) =>
			count + (Array.isArray(message.content) ? message.content.filter(({ type }) => type === "image").length : 0),
		0,
	);
}

function texts(message: Message): string[] {
	return Array.isArray(message.content)
		? message.content.flatMap((item) => (item.type === "text" ? [item.text] : []))
		: [message.content];
}
