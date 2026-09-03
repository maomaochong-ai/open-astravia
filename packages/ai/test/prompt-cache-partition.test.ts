import { describe, expect, it } from "vitest";
import { buildAzureOpenAIResponsesParams } from "../src/providers/azure-openai-responses/request.js";
import { buildCodexRequestBody } from "../src/providers/openai-codex/request.js";
import { buildOpenAIResponsesParams } from "../src/providers/openai-responses/request.js";
import type { Api, Context, Model } from "../src/types.js";

const CONTEXT: Context = { messages: [] };

describe("provider prompt cache partition", () => {
	it("prefers an explicit cache key while preserving the independent session identity", () => {
		const options = { sessionId: "member-session", promptCacheKey: "team-cache" };
		expect(buildOpenAIResponsesParams(model("openai-responses"), CONTEXT, options).prompt_cache_key).toBe(
			"team-cache",
		);
		expect(
			buildAzureOpenAIResponsesParams(model("azure-openai-responses"), CONTEXT, options, "deployment")
				.prompt_cache_key,
		).toBe("team-cache");
		const codex = buildCodexRequestBody(model("openai-codex-responses"), CONTEXT, options);
		expect(codex.prompt_cache_key).toBe("team-cache");
		expect(codex.prompt_cache_retention).toBe("in-memory");
	});

	it("retains the session id as the compatibility cache key", () => {
		expect(
			buildOpenAIResponsesParams(model("openai-responses"), CONTEXT, { sessionId: "member-session" })
				.prompt_cache_key,
		).toBe("member-session");
	});
});

function model<TApi extends Api>(api: TApi): Model<TApi> {
	return {
		id: "model",
		name: "Model",
		api,
		provider: "openai",
		baseUrl: "https://example.test",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100,
		maxTokens: 20,
	};
}
