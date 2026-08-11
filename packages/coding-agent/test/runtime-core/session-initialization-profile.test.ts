import type { Api, Model } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import type { CodingAgentRuntimeCompositionOptions } from "../../src/composition/contracts/index.js";
import { createCodingAgentSessionInitializationProfile } from "../../src/composition/session-initialization/profile.js";

describe("Coding Agent session initialization profile", () => {
	it("只投影 Session 初始化需要的配置并保留动态来源引用", () => {
		const promptResourceSource = {} as NonNullable<CodingAgentRuntimeCompositionOptions["promptResourceSource"]>;
		const promptSettingsSource = {} as NonNullable<CodingAgentRuntimeCompositionOptions["promptSettingsSource"]>;
		const createPluginRuntime = () => undefined;
		const options = {
			...createBaseOptions(),
			promptResourceSource,
			promptSettingsSource,
			createPluginRuntime,
			enableSubagents: false,
			subagentMaxConcurrent: 4,
			systemPromptAdvertisedToolNames: ["read", "write"],
		} satisfies CodingAgentRuntimeCompositionOptions;

		const profile = createCodingAgentSessionInitializationProfile(options);

		expect(Object.keys(profile).sort()).toEqual([
			"additionalHookAdapterFactories",
			"agentDir",
			"createCompactionExtensionRuntime",
			"createMemoryRolloverRuntime",
			"createPluginMcpRuntime",
			"createPluginRuntime",
			"createPromptResourceResolver",
			"createSubagentChildFactory",
			"createSystemPromptOptionsResolver",
			"createTodoRuntime",
			"enableSubagents",
			"generateCompaction",
			"hookConfigLayers",
			"initialModel",
			"initialThinkingLevel",
			"knowledgeRoot",
			"maxStopHookContinuations",
			"promptResourceSource",
			"promptSettingsSource",
			"resolveCompactionSettings",
			"resolvePromptResource",
			"resolveSystemPromptOptions",
			"subagentMaxConcurrent",
			"subagentTypeRegistry",
			"systemPromptAdvertisedToolNames",
		]);
		expect(profile.promptResourceSource).toBe(promptResourceSource);
		expect(profile.promptSettingsSource).toBe(promptSettingsSource);
		expect(profile.createPluginRuntime).toBe(createPluginRuntime);
		expect(profile.initialModel).toBe(MODEL);
		expect("conversationDir" in profile).toBe(false);
		expect("mcpSource" in profile).toBe(false);
		expect("streamFn" in profile).toBe(false);
	});

	it("在创建运行时资源前校验 prompt 动态来源必须成对提供", () => {
		const promptResourceSource = {} as NonNullable<CodingAgentRuntimeCompositionOptions["promptResourceSource"]>;
		const promptSettingsSource = {} as NonNullable<CodingAgentRuntimeCompositionOptions["promptSettingsSource"]>;

		expect(() =>
			createCodingAgentSessionInitializationProfile({
				...createBaseOptions(),
				promptResourceSource,
			}),
		).toThrowError("promptResourceSource and promptSettingsSource must be provided together");
		expect(() =>
			createCodingAgentSessionInitializationProfile({
				...createBaseOptions(),
				promptSettingsSource,
			}),
		).toThrowError("promptResourceSource and promptSettingsSource must be provided together");
	});
});

function createBaseOptions(): CodingAgentRuntimeCompositionOptions {
	return {
		conversationDir: "C:\\conversations",
		modelRegistry: {} as CodingAgentRuntimeCompositionOptions["modelRegistry"],
		initialModel: MODEL,
		initialThinkingLevel: "off",
	};
}

const MODEL: Model<Api> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
