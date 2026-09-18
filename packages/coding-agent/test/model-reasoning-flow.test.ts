import { getModelReasoningPreset, streamSimpleOpenAIResponses } from "@vetta/ai";
import { RuntimeModel } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { loadLocalModelConfig } from "../src/models/configuration/local-model-config.js";
import { applyProviderAndModelOverrides } from "../src/models/configuration/model-merge.js";
import { loadRemoteModelSource } from "../src/models/remote/remote-model-source.js";
import { resolveNextCodingAgentRpcThinkingLevel } from "../src/rpc/rpc-session-operations.js";

const levels = ["none", "low", "medium", "high", "xhigh", "custom-max"];
function config(id: string) {
	return {
		providers: {
			cpa: {
				api: "openai-responses",
				baseUrl: "https://proxy.example/v1",
				models: [{ id, reasoning: true, reasoningLevels: levels, defaultReasoningLevel: "xhigh" }],
			},
		},
	};
}

describe("model reasoning configuration to provider request", () => {
	it.each(["gpt-5.6", "gpt-6", "my-gpt-alias"])(
		"sends the selected xhigh value for %s after loading and refreshing model configuration",
		async (id) => {
			const loaded = loadLocalModelConfig("models.json", {
				exists: () => true,
				read: () => JSON.stringify(config(id)),
			});
			expect(loaded.error).toBeUndefined();
			const model = loaded.models[0];
			expect(getModelReasoningPreset(model)).toEqual({ levels, default: "xhigh" });
			expect(resolveNextCodingAgentRpcThinkingLevel(model, "high")).toBe("xhigh");
			expect(resolveNextCodingAgentRpcThinkingLevel(model, "xhigh")).toBe("custom-max");
			const runtime = new RuntimeModel({
				initialModel: model,
				initialThinkingLevel: "xhigh",
				catalog: { refresh() {}, listAvailable: () => loaded.models, find: () => model },
				credentials: { resolve: async () => "test-key", refreshAuth: async () => {} },
			});
			await runtime.selectModel(`cpa/${id}`, "always");
			runtime.setThinkingLevel("xhigh");
			const binding = await runtime.bind();
			const requests: unknown[] = [];
			const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
				requests.push(JSON.parse(String(init?.body)));
				return new Response(
					`data: ${JSON.stringify({ type: "response.completed", response: { id: "resp-test", status: "completed", output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } })}\n\n`,
					{ headers: { "content-type": "text/event-stream" } },
				);
			});
			const result = await streamSimpleOpenAIResponses(
				{ ...binding.model, api: "openai-responses" },
				{ messages: [] },
				{
					apiKey: "test-key",
					reasoning: binding.reasoning,
					fetch,
					maxRetries: 0,
				},
			).result();
			expect(result.stopReason).toBe("stop");
			expect(requests).toEqual([
				expect.objectContaining({ model: id, reasoning: { effort: "xhigh", summary: "auto" } }),
			]);
		},
	);

	it("preserves levels and defaults from remote catalogs and model overrides", async () => {
		const result = await loadRemoteModelSource("https://models.example", "test-key", {
			fetch: vi.fn<typeof globalThis.fetch>(async () => Response.json({ code: 0, data: config("gpt-6") })),
		});
		expect(result.status).toBe("loaded");
		expect(result.models[0]).toMatchObject({ reasoningLevels: levels, defaultReasoningLevel: "xhigh" });
		const overridden = applyProviderAndModelOverrides(
			result.models,
			undefined,
			new Map([["gpt-6", { reasoningLevels: ["high", "custom-max"], defaultReasoningLevel: "custom-max" }]]),
		);
		expect(getModelReasoningPreset(overridden[0])).toEqual({ levels: ["high", "custom-max"], default: "custom-max" });
	});

	it("rejects malformed local effort metadata at the configuration boundary", () => {
		const invalid = config("gpt-6");
		const serialized = JSON.stringify(invalid).replace(JSON.stringify(levels), '["high",42]');
		const result = loadLocalModelConfig("models.json", { exists: () => true, read: () => serialized });
		expect(result.models).toEqual([]);
		expect(result.error).toContain("reasoningLevels");
	});
});
