import { describe, expect, it } from "vitest";
import { convertResponsesMessages } from "../src/providers/openai-responses/messages.js";
import type { Context, Model } from "../src/types.js";

const model: Model<"openai-responses"> = {
	id: "vision-capable-custom-model",
	name: "Vision-capable custom model",
	api: "openai-responses",
	provider: "custom-openai",
	baseUrl: "https://provider.test/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 8_192,
};

describe("openai-responses tool-result images", () => {
	it("forwards tool-result images when image capability metadata is missing", () => {
		const context: Context = {
			messages: [
				{
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "read",
					content: [
						{ type: "text", text: "Read image file [image/png]" },
						{ type: "image", data: "ZmFrZQ==", mimeType: "image/png" },
					],
					isError: false,
					timestamp: 1,
				},
			],
		};

		expect(convertResponsesMessages(model, context, new Set())).toEqual([
			{
				type: "function_call_output",
				call_id: "call-1",
				output: "Read image file [image/png]",
			},
			{
				role: "user",
				content: [
					{ type: "input_text", text: "Attached image(s) from tool result:" },
					{
						type: "input_image",
						detail: "auto",
						image_url: "data:image/png;base64,ZmFrZQ==",
					},
				],
			},
		]);
	});
});
