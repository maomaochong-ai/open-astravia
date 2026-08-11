import type { Api, Message, Model, UserMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { projectModelCallContext } from "../../../src/adapters/runtime-core/context-runtime/model-call-context-projection.js";

describe("model call context projection", () => {
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
