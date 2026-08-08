import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import { streamOpenAICompletions } from "../src/providers/openai-completions.js";
import type { Model, Tool } from "../src/types.js";

const mockState = vi.hoisted(() => ({ lastParams: undefined as unknown }));

const baseModel: Model<"openai-completions"> = {
	id: "gpt-4o-mini",
	name: "GPT-4o mini",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 16_384,
};

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: async (params: unknown) => {
					mockState.lastParams = params;
					return {
						async *[Symbol.asyncIterator]() {
							yield {
								choices: [{ delta: {}, finish_reason: "stop" }],
								usage: {
									prompt_tokens: 1,
									completion_tokens: 1,
									prompt_tokens_details: { cached_tokens: 0 },
									completion_tokens_details: { reasoning_tokens: 0 },
								},
							};
						},
					};
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

describe("openai-completions tool_choice", () => {
	it("forwards toolChoice from simple options to payload", async () => {
		const tools: Tool[] = [
			{
				name: "ping",
				description: "Ping tool",
				parameters: Type.Object({
					ok: Type.Boolean(),
				}),
			},
		];
		let payload: unknown;

		await streamOpenAICompletions(
			baseModel,
			{
				messages: [
					{
						role: "user",
						content: "Call ping with ok=true",
						timestamp: Date.now(),
					},
				],
				tools,
			},
			{
				apiKey: "test",
				toolChoice: "required",
				onPayload: (params: unknown) => {
					payload = params;
				},
			},
		).result();

		const params = (payload ?? mockState.lastParams) as { tool_choice?: string; tools?: unknown[] };
		expect(params.tool_choice).toBe("required");
		expect(Array.isArray(params.tools)).toBe(true);
		expect(params.tools?.length ?? 0).toBeGreaterThan(0);
	});

	it("omits strict when compat disables strict mode", async () => {
		const model: Model<"openai-completions"> = {
			...baseModel,
			compat: { supportsStrictMode: false },
		};
		const tools: Tool[] = [
			{
				name: "ping",
				description: "Ping tool",
				parameters: Type.Object({
					ok: Type.Boolean(),
				}),
			},
		];
		let payload: unknown;

		await streamOpenAICompletions(
			model,
			{
				messages: [
					{
						role: "user",
						content: "Call ping with ok=true",
						timestamp: Date.now(),
					},
				],
				tools,
			},
			{
				apiKey: "test",
				onPayload: (params: unknown) => {
					payload = params;
				},
			},
		).result();

		const params = (payload ?? mockState.lastParams) as { tools?: Array<{ function?: Record<string, unknown> }> };
		const tool = params.tools?.[0]?.function;
		expect(tool).toBeTruthy();
		expect(tool?.strict).toBeUndefined();
		expect("strict" in (tool ?? {})).toBe(false);
	});
});
