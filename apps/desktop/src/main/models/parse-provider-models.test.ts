import { describe, expect, it } from "vitest";
import { parseProviderModels } from "./parse-provider-models";

describe("parseProviderModels", () => {
	it("reads the OpenAI shape and keeps ids sorted and deduplicated", () => {
		const models = parseProviderModels({
			object: "list",
			data: [
				{ id: "gpt-4o", object: "model", created: 1, owned_by: "openai" },
				{ id: "gpt-4o", object: "model", created: 2 },
				{ id: "gpt-4o-mini", object: "model" },
			],
		});

		expect(models).toEqual([{ id: "gpt-4o", ownedBy: "openai" }, { id: "gpt-4o-mini" }]);
	});

	it("keeps the first entry when the same id appears twice", () => {
		const [model] = parseProviderModels({
			data: [
				{ id: "llama3", context_length: 8192 },
				{ id: "llama3", context_length: 131072 },
			],
		});

		expect(model.contextWindow).toBe(8192);
	});

	it("reads Ollama's `{ models: [{ name }] }` payload", () => {
		const models = parseProviderModels({
			models: [{ name: "llama3:latest", model: "llama3:latest" }, { name: "qwen3:8b" }],
		});

		expect(models).toEqual([{ id: "llama3:latest" }, { id: "qwen3:8b" }]);
	});

	it("normalizes context window, max output and vendor under their common key names", () => {
		const models = parseProviderModels({
			data: [
				{ id: "a", context_length: 131072, max_output_tokens: 16384, owned_by: "meta-llama" },
				{ id: "b", context_window: "32768", max_tokens: 4096 },
				{ id: "c", max_model_len: 8192, display_name: "C 模型" },
				{ id: "d", n_ctx: 2048, context_length: -1, max_tokens: 0, display_name: "  " },
			],
		});

		expect(models).toEqual([
			{ id: "a", contextWindow: 131072, maxTokens: 16384, ownedBy: "meta-llama" },
			{ id: "b", contextWindow: 32768, maxTokens: 4096 },
			{ id: "c", name: "C 模型", contextWindow: 8192 },
			{ id: "d", contextWindow: 2048 },
		]);
	});

	it("drops a display name that only repeats the id", () => {
		const models = parseProviderModels({ data: [{ id: "qwen3", name: "qwen3" }] });

		expect(models).toEqual([{ id: "qwen3" }]);
	});

	it("detects vision and reasoning from booleans, capabilities and modalities", () => {
		const models = parseProviderModels({
			data: [
				{ id: "a", vision: true, reasoning: true },
				{ id: "b", supports_vision: true },
				{ id: "c", capabilities: { vision: true, reasoning: false } },
				{ id: "d", capabilities: ["chat", "thinking"] },
				{ id: "e", architecture: { input_modalities: ["text", "image"] } },
				{ id: "f", input_modalities: ["text"] },
			],
		});

		expect(models).toEqual([
			{ id: "a", vision: true, reasoning: true },
			{ id: "b", vision: true },
			{ id: "c", vision: true },
			{ id: "d", reasoning: true },
			{ id: "e", vision: true },
			{ id: "f" },
		]);
	});

	it("returns an empty list for payloads it cannot recognize", () => {
		expect(parseProviderModels(undefined)).toEqual([]);
		expect(parseProviderModels("nope")).toEqual([]);
		expect(parseProviderModels({ data: {} })).toEqual([]);
		expect(parseProviderModels({ data: [null, {}, { id: "   " }, 42] })).toEqual([]);
	});

	it("keeps the `model` field as an id fallback", () => {
		expect(parseProviderModels({ data: [{ model: "upstream-name" }] })).toEqual([{ id: "upstream-name" }]);
	});

	it("reads the thinking levels and input modalities used by aggregator gateways", () => {
		// migpie 这类聚合网关：`supported_reasoning_levels[].effort` + `modalities.input`。
		const models = parseProviderModels({
			data: [
				{
					id: "clinepass/cline-pass/deepseek-v4.1-flash",
					display_name: "DeepSeek V4.1 Flash",
					reasoning: true,
					supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "max" }],
					context_window: 1048576,
					max_output_tokens: 384000,
					modalities: { input: ["text", "image"] },
				},
			],
		});

		expect(models).toEqual([
			{
				id: "clinepass/cline-pass/deepseek-v4.1-flash",
				name: "DeepSeek V4.1 Flash",
				reasoning: true,
				reasoningLevels: ["low", "high", "max"],
				contextWindow: 1048576,
				maxTokens: 384000,
				vision: true,
			},
		]);
	});

	it("reads models.dev style effort options and treats declared levels as reasoning support", () => {
		const models = parseProviderModels({
			data: [
				{
					id: "deepseek/deepseek-v4-flash",
					reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "high", "max"] }],
				},
				{ id: "plain", supported_reasoning_levels: ["low", "high"] },
			],
		});

		expect(models).toEqual([
			{ id: "deepseek/deepseek-v4-flash", reasoning: true, reasoningLevels: ["low", "high", "max"] },
			{ id: "plain", reasoning: true, reasoningLevels: ["low", "high"] },
		]);
	});
});
