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

describe("Anthropic system prompt cache breakpoint", () => {
	const splitContext: Context = {
		systemPrompt: "STABLE PREFIX\n\nVOLATILE TAIL",
		systemPromptStableLength: "STABLE PREFIX".length,
		messages: [{ role: "user", content: "Hello", timestamp: 1 }],
	};

	function systemBlocks(params: ReturnType<typeof buildAnthropicParams>) {
		const system = params.system;
		if (!Array.isArray(system)) return [];
		return system.map((block) => ({ text: block.text, cacheControl: block.cache_control }));
	}

	it("keeps a single cached system block when no stable length is declared", () => {
		const params = buildAnthropicParams(model, context, false);

		expect(systemBlocks(params)).toEqual([{ text: "System prompt", cacheControl: { type: "ephemeral" } }]);
	});

	it("splits into a cached prefix and an uncached tail that reconstruct the prompt exactly", () => {
		const params = buildAnthropicParams(model, splitContext, false);
		const blocks = systemBlocks(params);

		expect(blocks).toEqual([
			{ text: "STABLE PREFIX", cacheControl: { type: "ephemeral" } },
			{ text: "\n\nVOLATILE TAIL", cacheControl: undefined },
		]);
		expect(blocks.map(({ text }) => text).join("")).toBe(splitContext.systemPrompt);
	});

	it("does not split when caching is disabled — an extra block would buy nothing", () => {
		const params = buildAnthropicParams(model, splitContext, false, { cacheRetention: "none" });

		expect(systemBlocks(params)).toEqual([{ text: "STABLE PREFIX\n\nVOLATILE TAIL", cacheControl: undefined }]);
	});

	it("does not split when the breakpoint sits at either end of the prompt", () => {
		for (const stableLength of [0, splitContext.systemPrompt?.length]) {
			const params = buildAnthropicParams(model, { ...splitContext, systemPromptStableLength: stableLength }, false);

			expect(systemBlocks(params)).toHaveLength(1);
		}
	});

	it("splits after the Claude Code preamble on the OAuth path", () => {
		const params = buildAnthropicParams(model, splitContext, true);

		expect(systemBlocks(params)).toEqual([
			{
				text: "You are Claude Code, Anthropic's official CLI for Claude.",
				cacheControl: { type: "ephemeral" },
			},
			{ text: "STABLE PREFIX", cacheControl: { type: "ephemeral" } },
			{ text: "\n\nVOLATILE TAIL", cacheControl: undefined },
		]);
	});

	it("emits only the preamble on the OAuth path when there is no system prompt", () => {
		const params = buildAnthropicParams(model, { messages: [] }, true);

		expect(systemBlocks(params)).toHaveLength(1);
	});

	it("omits the system field entirely when there is no system prompt", () => {
		const params = buildAnthropicParams(model, { messages: [] }, false);

		expect(params.system).toBeUndefined();
	});
});
