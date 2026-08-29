import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import { DOMAIN_AI_CAPABILITIES, DOMAIN_AI_CAPABILITY_CATALOG } from "../../src/domain.js";

describe("ai domain capabilities", () => {
	it("uses one stable id per ai operation", () => {
		expect(Object.values(DOMAIN_AI_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}ai.models.list`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}ai.complete`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}ai.chat`,
		]);
		expect(DOMAIN_AI_CAPABILITY_CATALOG.some((entry) => entry.id === DOMAIN_AI_CAPABILITIES.CHAT.id)).toBe(true);
	});

	it("accepts a minimal chat request and strips unknown fields", () => {
		const parsed = DOMAIN_AI_CAPABILITIES.CHAT.parseInput({
			messages: [{ role: "user", content: "hi", ignored: true }],
			ignored: true,
		});
		expect(parsed).toEqual({ messages: [{ role: "user", content: "hi" }] });
	});

	it("accepts model entries whose output limit is unknown", () => {
		const result = DOMAIN_AI_CAPABILITIES.LIST_MODELS.parseOutput({
			defaultModel: "custom/test-model",
			models: [
				{
					modelKey: "custom/test-model",
					provider: "custom",
					id: "test-model",
					name: "Test model",
					api: "openai-completions",
					reasoning: false,
					input: ["text"],
					contextWindow: 128_000,
				},
			],
		});

		expect(result.models[0]).not.toHaveProperty("maxTokens");
	});

	it("accepts a full multi-turn chat request with tools and tool results", () => {
		const parsed = DOMAIN_AI_CAPABILITIES.CHAT.parseInput({
			modelKey: "openai/gpt-5",
			systemPrompt: "you answer with tools",
			messages: [
				{ role: "user", content: "look it up" },
				{
					role: "assistant",
					content: "",
					toolCalls: [{ id: "call-1", name: "lookup_record", arguments: { id: "record-1", field: "title" } }],
				},
				{
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "lookup_record",
					content: "not found",
					isError: true,
				},
				{ role: "assistant", content: "let me retry" },
			],
			tools: [
				{
					name: "lookup_record",
					description: "Read one record",
					parameters: { type: "object", properties: { id: { type: "string" }, field: { type: "string" } } },
				},
			],
			temperature: 0.7,
			maxTokens: 131_072,
			reasoning: "low",
		});
		expect(parsed.messages).toHaveLength(4);
		expect(parsed.tools?.[0]?.parameters).toHaveProperty("type", "object");
		expect(parsed.maxTokens).toBe(131_072);
	});

	it("rejects malformed chat requests with stable error codes", () => {
		const expectInvalid = (input: unknown): void => {
			expect(() => DOMAIN_AI_CAPABILITIES.CHAT.parseInput(input)).toThrowError(
				expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
			);
		};
		expectInvalid({ messages: [] });
		expectInvalid({ messages: [{ role: "user", content: "" }] });
		expectInvalid({ messages: [{ role: "system", content: "nope" }] });
		expectInvalid({ messages: [{ role: "toolResult", toolCallId: "", toolName: "t", content: "x" }] });
		expectInvalid({
			messages: [{ role: "user", content: "hi" }],
			tools: [{ name: "9bad name", description: "", parameters: {} }],
		});
	});

	it("validates and cleans chat results including tool calls", () => {
		const result = DOMAIN_AI_CAPABILITIES.CHAT.parseOutput({
			modelKey: "openai/gpt-5",
			text: "",
			toolCalls: [{ id: "call-1", name: "lookup_record", arguments: { id: "record-1" }, ignored: true }],
			stopReason: "toolUse",
			usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, ignored: true },
			ignored: true,
		});
		expect(result).toEqual({
			modelKey: "openai/gpt-5",
			text: "",
			toolCalls: [{ id: "call-1", name: "lookup_record", arguments: { id: "record-1" } }],
			stopReason: "toolUse",
			usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
		});
		expect(() =>
			DOMAIN_AI_CAPABILITIES.CHAT.parseOutput({
				modelKey: "openai/gpt-5",
				text: "x",
				toolCalls: [],
				stopReason: "error",
				usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
	});

	it("keeps the single-turn complete contract unchanged", () => {
		expect(
			DOMAIN_AI_CAPABILITIES.COMPLETE.parseInput({ prompt: "hello", modelKey: "openai/gpt-5", ignored: true }),
		).toEqual({ prompt: "hello", modelKey: "openai/gpt-5" });
		expect(() => DOMAIN_AI_CAPABILITIES.COMPLETE.parseInput({ prompt: "" })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
	});
});
