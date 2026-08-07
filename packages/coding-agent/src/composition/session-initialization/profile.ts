import type { CodingAgentRuntimeCompositionOptions } from "../contracts/index.js";

export type CodingAgentSessionInitializationProfile = Pick<
	CodingAgentRuntimeCompositionOptions,
	| "additionalHookAdapterFactories"
	| "agentDir"
	| "createCompactionExtensionRuntime"
	| "createMemoryRolloverRuntime"
	| "createPluginMcpRuntime"
	| "createPluginRuntime"
	| "createPromptResourceResolver"
	| "createSubagentChildFactory"
	| "createSystemPromptOptionsResolver"
	| "createTodoRuntime"
	| "enableSubagents"
	| "generateCompaction"
	| "hookConfigLayers"
	| "initialModel"
	| "initialThinkingLevel"
	| "knowledgeRoot"
	| "maxStopHookContinuations"
	| "promptResourceSource"
	| "promptSettingsSource"
	| "resolveCompactionSettings"
	| "resolvePromptResource"
	| "resolveSystemPromptOptions"
	| "subagentMaxConcurrent"
	| "subagentTypeRegistry"
	| "systemPromptAdvertisedToolNames"
>;

export function createCodingAgentSessionInitializationProfile(
	options: CodingAgentRuntimeCompositionOptions,
): CodingAgentSessionInitializationProfile {
	if ((options.promptResourceSource === undefined) !== (options.promptSettingsSource === undefined)) {
		throw new Error("promptResourceSource and promptSettingsSource must be provided together");
	}

	return {
		additionalHookAdapterFactories: options.additionalHookAdapterFactories,
		agentDir: options.agentDir,
		createCompactionExtensionRuntime: options.createCompactionExtensionRuntime,
		createMemoryRolloverRuntime: options.createMemoryRolloverRuntime,
		createPluginMcpRuntime: options.createPluginMcpRuntime,
		createPluginRuntime: options.createPluginRuntime,
		createPromptResourceResolver: options.createPromptResourceResolver,
		createSubagentChildFactory: options.createSubagentChildFactory,
		createSystemPromptOptionsResolver: options.createSystemPromptOptionsResolver,
		createTodoRuntime: options.createTodoRuntime,
		enableSubagents: options.enableSubagents,
		generateCompaction: options.generateCompaction,
		hookConfigLayers: options.hookConfigLayers,
		initialModel: options.initialModel,
		initialThinkingLevel: options.initialThinkingLevel,
		knowledgeRoot: options.knowledgeRoot,
		maxStopHookContinuations: options.maxStopHookContinuations,
		promptResourceSource: options.promptResourceSource,
		promptSettingsSource: options.promptSettingsSource,
		resolveCompactionSettings: options.resolveCompactionSettings,
		resolvePromptResource: options.resolvePromptResource,
		resolveSystemPromptOptions: options.resolveSystemPromptOptions,
		subagentMaxConcurrent: options.subagentMaxConcurrent,
		subagentTypeRegistry: options.subagentTypeRegistry,
		systemPromptAdvertisedToolNames: options.systemPromptAdvertisedToolNames,
	};
}
