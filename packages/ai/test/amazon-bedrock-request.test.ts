import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { buildBedrockCommandInput } from "../src/providers/amazon-bedrock/request.js";
import type { Context, Model } from "../src/types.js";

const context: Context = {
	systemPrompt: "System prompt",
	messages: [{ role: "user", content: "Hello", timestamp: 1 }],
	tools: [{ name: "read", description: "Read a file", parameters: Type.Object({ path: Type.String() }) }],
};

const model: Model<"bedrock-converse-stream"> = {
	id: "global.anthropic.claude-sonnet-4-6-v1",
	name: "Claude Sonnet 4.6",
	api: "bedrock-converse-stream",
	provider: "amazon-bedrock",
	baseUrl: "",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 1, cacheWrite: 1 },
	contextWindow: 200_000,
	maxTokens: 64_000,
};

describe("Amazon Bedrock request parameters", () => {
	it("adds one-hour cache points to the system and final user message", () => {
		const input = buildBedrockCommandInput(model, context, { cacheRetention: "long" });

		expect(input.system?.[1]).toEqual({ cachePoint: { type: "default", ttl: "1h" } });
		expect(input.messages?.[0]?.content?.at(-1)).toEqual({ cachePoint: { type: "default", ttl: "1h" } });
	});

	it("maps tool choices without changing tool schemas", () => {
		const any = buildBedrockCommandInput(model, context, { toolChoice: "any" });
		const none = buildBedrockCommandInput(model, context, { toolChoice: "none" });

		expect(any.toolConfig?.toolChoice).toEqual({ any: {} });
		expect(any.toolConfig?.tools?.[0]?.toolSpec?.inputSchema?.json).toEqual(context.tools?.[0]?.parameters);
		expect(none.toolConfig).toBeUndefined();
	});

	it("uses adaptive thinking for Claude 4.6", () => {
		const input = buildBedrockCommandInput(model, context, { reasoning: "medium" });

		expect(input.additionalModelRequestFields).toEqual({
			thinking: { type: "adaptive" },
			output_config: { effort: "medium" },
		});
	});

	it("uses custom budgets and interleaved thinking for older Claude models", () => {
		const input = buildBedrockCommandInput({ ...model, id: "global.anthropic.claude-sonnet-4-5-v1" }, context, {
			reasoning: "high",
			thinkingBudgets: { high: 4096 },
		});

		expect(input.additionalModelRequestFields).toEqual({
			thinking: { type: "enabled", budget_tokens: 4096 },
			anthropic_beta: ["interleaved-thinking-2025-05-14"],
		});
	});
});
