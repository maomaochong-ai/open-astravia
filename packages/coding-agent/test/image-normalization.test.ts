import type { Api, Message, Model } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import { type ModelInputImageProcessor, normalizeModelInputImages } from "../src/model-context/image-normalization.js";
import { CodingAgentModelCallMessageFinalizer } from "../src/model-context/model-call-message-finalizer.js";

describe("model input image normalization", () => {
	it("normalizes images from user and tool results without mutating source messages", async () => {
		const processor = imageProcessor(async (data) => resized(`${data}-small`, "image/jpeg"));
		const messages = [userImage("user"), assistant(), toolImage("tool")];

		const normalized = await normalizeModelInputImages(messages, new AbortController().signal, { processor });

		expect(imageData(normalized[0])).toEqual(["user-small"]);
		expect(normalized[1]).toBe(messages[1]);
		expect(imageData(normalized[2])).toEqual(["tool-small"]);
		expect(imageData(messages[0])).toEqual(["user"]);
		expect(processor.resize).toHaveBeenCalledTimes(2);
	});

	it("replaces an unsafe image with a visible failure note", async () => {
		const processor = imageProcessor(async () => ({
			failed: true,
			mimeType: "image/png",
			originalSizeBytes: 10,
			reason: "processing_failed",
			message: "decode failed",
		}));

		const normalized = await normalizeModelInputImages([userImage("broken")], new AbortController().signal, {
			processor,
		});

		expect(textContent(normalized[0])).toContain("Image omitted");
		expect(textContent(normalized[0])).toContain("decode failed");
		expect(imageData(normalized[0])).toEqual([]);
	});

	it("honors the existing auto-resize setting at the final model boundary", async () => {
		const processor = imageProcessor(async () => resized("must-not-run", "image/jpeg"));
		const finalizer = new CodingAgentModelCallMessageFinalizer(
			{
				getImageAutoResize: () => false,
			},
			processor,
		);
		const message = userImage("original");

		const finalized = await finalizer.finalize(
			{
				sessionId: "session-1",
				turnId: "turn-1",
				messages: [message],
				modelBinding: { model: MODEL },
			},
			new AbortController().signal,
		);

		expect(finalized[0]).toBe(message);
		expect(processor.resize).not.toHaveBeenCalled();
	});

	it("captures image settings once at Turn admission", async () => {
		let blocked = false;
		const reload = vi.fn();
		const finalizer = new CodingAgentModelCallMessageFinalizer({
			reloadImageSettings: reload,
			getImageAutoResize: () => false,
			getBlockImages: () => blocked,
		});
		const firstTurn = finalizer.bindForTurn(turnContext("turn-1"));
		blocked = true;

		const firstResult = await firstTurn.finalize(
			finalizationInput("turn-1", [userImage("first")]),
			new AbortController().signal,
		);
		const secondTurn = finalizer.bindForTurn(turnContext("turn-2"));
		const secondResult = await secondTurn.finalize(
			finalizationInput("turn-2", [userImage("second")]),
			new AbortController().signal,
		);

		expect(imageData(firstResult[0])).toEqual(["first"]);
		expect(imageData(secondResult[0])).toEqual([]);
		expect(reload).toHaveBeenCalledTimes(2);
	});
});

function turnContext(operationId: string) {
	return {
		sessionId: "session-1",
		operationId,
		reason: "turn" as const,
		signal: new AbortController().signal,
	};
}

function finalizationInput(turnId: string, messages: readonly Message[]) {
	return {
		sessionId: "session-1",
		turnId,
		messages,
		modelBinding: { model: MODEL },
	};
}

function imageProcessor(
	resize: ModelInputImageProcessor["resize"],
): ModelInputImageProcessor & { resize: ReturnType<typeof vi.fn<ModelInputImageProcessor["resize"]>> } {
	return { resize: vi.fn(resize) };
}

function resized(data: string, mimeType: string) {
	return {
		data,
		mimeType,
		originalWidth: 100,
		originalHeight: 100,
		width: 50,
		height: 50,
		wasResized: true,
	};
}

function userImage(data: string): Extract<Message, { role: "user" }> {
	return { role: "user", content: [{ type: "image", data, mimeType: "image/png" }], timestamp: 1 };
}

function toolImage(data: string): Extract<Message, { role: "toolResult" }> {
	return {
		role: "toolResult",
		toolCallId: "call-1",
		toolName: "read",
		content: [{ type: "image", data, mimeType: "image/png" }],
		isError: false,
		timestamp: 1,
	};
}

function assistant(): Extract<Message, { role: "assistant" }> {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

function imageData(message: Message | undefined): string[] {
	if (!message || !Array.isArray(message.content)) return [];
	return message.content.flatMap((item) => (item.type === "image" ? [item.data] : []));
}

function textContent(message: Message | undefined): string {
	if (!message || !Array.isArray(message.content)) return "";
	return message.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n");
}

const MODEL: Model<Api> = {
	id: "model",
	name: "Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
