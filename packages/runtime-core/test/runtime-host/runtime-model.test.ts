import type { Api, Model } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import {
	RuntimeModel,
	type RuntimeModelCatalog,
	type RuntimeModelCredentialResolver,
} from "../../src/runtime-host/index.js";

describe("RuntimeModel", () => {
	it("resolves available models before fallback and preserves model ids containing slashes", async () => {
		const available = model("available", "model/with/slash", true);
		const fallback = model("fallback", "fallback-model", true);
		const find = vi.fn((provider: string, modelId: string) =>
			provider === fallback.provider && modelId === fallback.id ? fallback : undefined,
		);
		const runtime = createRuntime({
			catalog: {
				refresh() {},
				listAvailable: () => [INITIAL_MODEL, available],
				find,
			},
		});

		await runtime.selectModel("available/model/with/slash", "always");
		expect(runtime.readCurrentModel()).toBe(available);
		expect(find).not.toHaveBeenCalled();

		await runtime.selectModel("fallback/fallback-model", "always");
		expect(runtime.readCurrentModel()).toBe(fallback);
		expect(find).toHaveBeenCalledWith("fallback", "fallback-model");
	});

	it("keeps selection behavior and credential validation compatible with the legacy controller", async () => {
		const alternate = model("test", "alternate", true);
		const resolve = vi.fn(async (candidate: Model<Api>) => (candidate.id === "without-key" ? undefined : "test-key"));
		const withoutKey = model("test", "without-key", true);
		const runtime = createRuntime({
			catalog: catalog([INITIAL_MODEL, alternate, withoutKey]),
			credentials: { resolve, refreshAuth: async () => {} },
		});

		await runtime.selectModel("missing/model", "always");
		expect(runtime.readCurrentModel()).toBe(INITIAL_MODEL);

		await runtime.selectModel("test/initial", "if-changed");
		expect(resolve).not.toHaveBeenCalled();

		await runtime.selectModel("test/initial", "always");
		expect(resolve).toHaveBeenCalledOnce();

		await expect(runtime.selectModel("test/without-key", "always")).rejects.toThrow(
			"No API key for test/without-key",
		);
		expect(runtime.readCurrentModel()).toBe(INITIAL_MODEL);
	});

	it("clamps canonical thinking levels while preserving custom model levels", async () => {
		const reasoning = model("test", "reasoning", true);
		const xhigh = model("openai", "gpt-5.3-test", true);
		const runtime = createRuntime({
			initialThinkingLevel: "high",
			catalog: catalog([INITIAL_MODEL, reasoning, xhigh]),
		});

		expect(runtime.readThinkingLevel()).toBe("off");
		runtime.setThinkingLevel("custom-max");
		expect(runtime.readThinkingLevel()).toBe("custom-max");

		await runtime.selectModel("test/reasoning", "always");
		runtime.setThinkingLevel("xhigh");
		expect(runtime.readThinkingLevel()).toBe("high");

		await runtime.selectModel("openai/gpt-5.3-test", "always");
		runtime.setThinkingLevel("xhigh");
		expect(runtime.readThinkingLevel()).toBe("xhigh");
	});

	it("shares view state and returns stable immutable bindings for active turns", async () => {
		const alternate = model("test", "alternate", true);
		const refresh = vi.fn();
		const refreshAuth = vi.fn(async () => {});
		const runtime = createRuntime({
			catalog: {
				refresh,
				listAvailable: () => [INITIAL_MODEL, alternate],
				find: () => undefined,
			},
			credentials: { resolve: async () => "test-key", refreshAuth },
		});

		const available = runtime.readAvailableModels();
		expect(available).toEqual([INITIAL_MODEL, alternate]);
		expect(available).not.toBe(runtime.readAvailableModels());
		runtime.refreshAvailableModels();
		await runtime.refreshAuth("token");
		expect(refresh).toHaveBeenCalledOnce();
		expect(refreshAuth).toHaveBeenCalledWith("token");

		const firstBinding = runtime.bind();
		expect(Object.isFrozen(firstBinding)).toBe(true);
		expect(firstBinding).toEqual({ model: INITIAL_MODEL, reasoning: undefined });

		await runtime.selectModel("test/alternate", "always");
		runtime.setThinkingLevel("medium");
		const secondBinding = runtime.bind();

		expect(firstBinding).toEqual({ model: INITIAL_MODEL, reasoning: undefined });
		expect(secondBinding).toEqual({ model: alternate, reasoning: "medium" });
	});
});

function createRuntime(
	options: {
		readonly initialThinkingLevel?: "off" | "high";
		readonly catalog?: RuntimeModelCatalog;
		readonly credentials?: RuntimeModelCredentialResolver;
	} = {},
): RuntimeModel {
	return new RuntimeModel({
		initialModel: INITIAL_MODEL,
		initialThinkingLevel: options.initialThinkingLevel ?? "off",
		catalog: options.catalog ?? catalog([INITIAL_MODEL]),
		credentials: options.credentials ?? {
			resolve: async () => "test-key",
			refreshAuth: async () => {},
		},
	});
}

function catalog(models: readonly Model<Api>[]): RuntimeModelCatalog {
	return {
		refresh() {},
		listAvailable: () => models,
		find: (provider, modelId) =>
			models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
	};
}

function model(provider: string, id: string, reasoning: boolean): Model<Api> {
	return {
		id,
		name: id,
		api: "openai-responses",
		provider,
		baseUrl: "https://example.test",
		reasoning,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8_000,
		maxTokens: 1_000,
	};
}

const INITIAL_MODEL = model("test", "initial", false);
