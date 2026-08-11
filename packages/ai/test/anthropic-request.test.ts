import { describe, expect, it } from "vitest";
import { buildAnthropicParams } from "../src/providers/anthropic/request.js";
import type { Context, Model } from "../src/types.js";

const context: Context = {
	systemPrompt: "System prompt",
	messages: [{ role: "user", content: "Hello", timestamp: 1 }],
};

const model: Model<"anthropic-messages"> = {
	id: "claude-sonnet-4-6",
	name: "Claude Sonnet 4.6",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 64_000,
};

describe("Anthropic request parameters", () => {
	it("applies long cache retention only to the official endpoint", () => {
		const official = buildAnthropicParams(model, context, false, { cacheRetention: "long" });
		const proxied = buildAnthropicParams({ ...model, baseUrl: "https://proxy.example.com/v1" }, context, false, {
			cacheRetention: "long",
		});
		const officialSystem = official.system?.[0];
		const proxiedSystem = proxied.system?.[0];

		expect(typeof officialSystem === "string" ? undefined : officialSystem?.cache_control).toEqual({
			type: "ephemeral",
			ttl: "1h",
		});
		expect(typeof proxiedSystem === "string" ? undefined : proxiedSystem?.cache_control).toEqual({
			type: "ephemeral",
		});
	});

	it("omits cache control when retention is disabled", () => {
		const params = buildAnthropicParams(model, context, false, { cacheRetention: "none" });
		const system = params.system?.[0];

		expect(typeof system === "string" ? undefined : system?.cache_control).toBeUndefined();
		expect(params.messages[0]?.content).toBe("Hello");
	});

	it("uses adaptive thinking and effort for supported models", () => {
		const params = buildAnthropicParams(model, context, false, {
			thinkingEnabled: true,
			effort: "medium",
		});

		expect(params.thinking).toEqual({ type: "adaptive" });
		expect(params.output_config).toEqual({ effort: "medium" });
	});

	it("uses a token budget for older reasoning models", () => {
		const params = buildAnthropicParams({ ...model, id: "claude-sonnet-4-5" }, context, false, {
			thinkingEnabled: true,
			thinkingBudgetTokens: 2048,
		});

		expect(params.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
		expect(params.output_config).toBeUndefined();
	});
});
