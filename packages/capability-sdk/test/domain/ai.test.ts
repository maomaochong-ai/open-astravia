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

	it("accepts a full multi-turn chat request with tools and tool results", () => {
		const parsed = DOMAIN_AI_CAPABILITIES.CHAT.parseInput({
			modelKey: "openai/gpt-5",
			systemPrompt: "you are a referee",
			messages: [
				{ role: "user", content: "your move" },
				{
					role: "assistant",
					content: "",
					toolCalls: [{ id: "call-1", name: "make_move", arguments: { from: "a1", to: "a2" } }],
				},
				{ role: "toolResult", toolCallId: "call-1", toolName: "make_move", content: "illegal", isError: true },
				{ role: "assistant", content: "let me retry" },
			],
			tools: [
				{
					name: "make_move",
					description: "Play a move",
					parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } },
				},
			],
			temperature: 0.7,
			maxTokens: 2048,
			reasoning: "low",
		});
		expect(parsed.messages).toHaveLength(4);
		expect(parsed.tools?.[0]?.parameters).toHaveProperty("type", "object");
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
			toolCalls: [{ id: "call-1", name: "make_move", arguments: { from: "a1" }, ignored: true }],
			stopReason: "toolUse",
			usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, ignored: true },
			ignored: true,
		});
		expect(result).toEqual({
			modelKey: "openai/gpt-5",
			text: "",
			toolCalls: [{ id: "call-1", name: "make_move", arguments: { from: "a1" } }],
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
