import type { Api, Model } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import type { CodingAgentRuntimeCompositionOptions } from "../../src/composition/contracts/index.js";
import { createCodingAgentSessionInitializationProfile } from "../../src/composition/session-initialization/profile.js";
import { createCodingAgentNodeSessionExecutionEnvironment } from "../../src/host/tool-environment/node/node-session-execution-environment.js";
import { createTestConversationPersistence } from "../fixtures/conversation-persistence.js";

describe("Coding Agent session initialization profile", () => {
	it("只投影 Session 初始化需要的配置并保留动态来源引用", () => {
		const promptResourceSource = {} as NonNullable<CodingAgentRuntimeCompositionOptions["promptResourceSource"]>;
		const promptSettingsSource = {} as NonNullable<CodingAgentRuntimeCompositionOptions["promptSettingsSource"]>;
		const createPromptRuntimeSources = async () => ({
			resourceSource: promptResourceSource,
			settingsSource: promptSettingsSource,
		});
		const createPluginRuntime = () => undefined;
		const createContextRuntime = (() => {
			throw new Error("not called by profile projection");
		}) as NonNullable<CodingAgentRuntimeCompositionOptions["createContextRuntime"]>;
		const options = {
			...createBaseOptions(),
			promptResourceSource,
			promptSettingsSource,
			createPromptRuntimeSources,
			createPluginRuntime,
			createContextRuntime,
			enableSubagents: false,
			subagentMaxConcurrent: 4,
			systemPromptAdvertisedToolNames: ["read", "write"],
		} satisfies CodingAgentRuntimeCompositionOptions;

		const profile = createCodingAgentSessionInitializationProfile(options);

		expect(Object.keys(profile).sort()).toEqual([
			"additionalHookAdapterFactories",
			"agentDir",
			"createCompactionExtensionRuntime",
			"createContextRuntime",
			"createMemoryRolloverRuntime",
			"createPluginMcpRuntime",
			"createPluginRuntime",
			"createPromptResourceResolver",
			"createPromptRuntimeSources",
			"createSessionExecutionEnvironment",
			"createSessionExtensionDefinitions",
			"createSubagentChildFactory",
			"createSystemPromptOptionsResolver",
			"createTodoRuntime",
			"enableSubagents",
			"generateCompaction",
			"hookConfigLayers",
			"initialModel",
			"initialThinkingLevel",
			"knowledgeRuntime",
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
		expect(profile.createPromptRuntimeSources).toBe(createPromptRuntimeSources);
		expect(profile.createPluginRuntime).toBe(createPluginRuntime);
		expect(profile.createContextRuntime).toBe(createContextRuntime);
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
		createConversationPersistence: createTestConversationPersistence,
		createToolEnvironment: () => ({ registrations: [], dispose() {} }),
		createSessionExecutionEnvironment: createCodingAgentNodeSessionExecutionEnvironment,
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
