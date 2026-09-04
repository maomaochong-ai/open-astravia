import { describe, expect, it } from "vitest";
import { convertMessages } from "../src/providers/google-shared.js";
import type { Context, Model } from "../src/types.js";

describe("google-shared convertMessages", () => {
	it("forwards user images when image capability metadata is missing", () => {
		const model: Model<"google-generative-ai"> = {
			id: "gemini-3-pro-preview",
			name: "Gemini 3 Pro Preview",
			api: "google-generative-ai",
			provider: "google",
			baseUrl: "https://generativelanguage.googleapis.com",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		};
		const contents = convertMessages(model, {
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "inspect" },
						{ type: "image", data: "ZmFrZQ==", mimeType: "image/png" },
					],
					timestamp: 1,
				},
			],
		});

		expect(contents[0]?.parts).toEqual([
			{ text: "inspect" },
			{ inlineData: { mimeType: "image/png", data: "ZmFrZQ==" } },
		]);
	});

	it("forwards tool-result images when image capability metadata is missing", () => {
		const model: Model<"google-generative-ai"> = {
			id: "gemini-3-pro-preview",
			name: "Gemini 3 Pro Preview",
			api: "google-generative-ai",
			provider: "google",
			baseUrl: "https://generativelanguage.googleapis.com",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		};
		const contents = convertMessages(model, {
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
		});

		expect(contents[0]?.parts?.[0]?.functionResponse).toMatchObject({
			name: "read",
			response: { output: "Read image file [image/png]" },
			parts: [{ inlineData: { mimeType: "image/png", data: "ZmFrZQ==" } }],
		});
	});

	it("converts unsigned tool calls to text for Gemini 3", () => {
		const model: Model<"google-generative-ai"> = {
			id: "gemini-3-pro-preview",
			name: "Gemini 3 Pro Preview",
			api: "google-generative-ai",
			provider: "google",
			baseUrl: "https://generativelanguage.googleapis.com",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		};

		const now = Date.now();
		const context: Context = {
			messages: [
				{ role: "user", content: "Hi", timestamp: now },
				{
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "call_1",
							name: "bash",
							arguments: { command: "ls -la" },
							// No thoughtSignature: simulates Claude via Antigravity.
						},
					],
					api: "google-gemini-cli",
					provider: "google-antigravity",
					model: "claude-sonnet-4-20250514",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: now,
				},
			],
		};

		const contents = convertMessages(model, context);

		let toolTurn: (typeof contents)[number] | undefined;
		for (let i = contents.length - 1; i >= 0; i -= 1) {
			if (contents[i]?.role === "model") {
				toolTurn = contents[i];
				break;
			}
		}

		expect(toolTurn).toBeTruthy();
		expect(toolTurn?.parts?.some((p) => p.functionCall !== undefined)).toBe(false);

		const text = toolTurn?.parts?.map((p) => p.text ?? "").join("\n");
		// Should contain historical context note to prevent mimicry
		expect(text).toContain("Historical context");
		expect(text).toContain("bash");
		expect(text).toContain("ls -la");
		expect(text).toContain("Do not mimic this format");
	});

	it("repairs stale tool result names by matching the function call", () => {
		const model: Model<"google-generative-ai"> = {
			id: "gemini-2.5-flash",
			name: "Gemini 2.5 Flash",
			api: "google-generative-ai",
			provider: "google",
			baseUrl: "https://generativelanguage.googleapis.com",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		};
		const contents = convertMessages(model, {
			messages: [
				{ role: "user", content: "inspect the team", timestamp: 1 },
				{
					role: "assistant",
					content: [{ type: "toolCall", id: "call-1", name: "team_list_members", arguments: {} }],
					api: "google-gemini-cli",
					provider: "google-antigravity",
					model: "gemini-2.5-flash",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "toolUse",
					timestamp: 2,
				},
				{
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "todo",
					content: [{ type: "text", text: "members" }],
					isError: false,
					timestamp: 3,
				},
			],
		});

		const response = contents
			.flatMap((content) => content.parts ?? [])
			.find((part) => part.functionResponse)?.functionResponse;
		expect(response).toMatchObject({ name: "team_list_members", response: { output: "members" } });
	});
});
