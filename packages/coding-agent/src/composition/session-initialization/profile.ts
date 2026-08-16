import type { CodingAgentRuntimeCompositionOptions } from "../contracts/index.js";

export type CodingAgentSessionInitializationProfile = Pick<
	CodingAgentRuntimeCompositionOptions,
	| "additionalHookAdapterFactories"
	| "agentDir"
	| "createCompactionExtensionRuntime"
	| "createMemoryRolloverRuntime"
	| "createPluginMcpRuntime"
	| "createPluginRuntime"
	| "createPromptRuntimeSources"
	| "createPromptResourceResolver"
	| "createSessionExtensionDefinitions"
	| "createSubagentChildFactory"
	| "createSystemPromptOptionsResolver"
	| "createTodoRuntime"
	| "enableSubagents"
	| "generateCompaction"
	| "hookConfigLayers"
	| "initialModel"
	| "initialThinkingLevel"
	| "knowledgeRuntime"
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
		createPromptRuntimeSources: options.createPromptRuntimeSources,
		createPromptResourceResolver: options.createPromptResourceResolver,
		createSessionExtensionDefinitions: options.createSessionExtensionDefinitions,
		createSubagentChildFactory: options.createSubagentChildFactory,
		createSystemPromptOptionsResolver: options.createSystemPromptOptionsResolver,
		createTodoRuntime: options.createTodoRuntime,
		enableSubagents: options.enableSubagents,
		generateCompaction: options.generateCompaction,
		hookConfigLayers: options.hookConfigLayers,
		initialModel: options.initialModel,
		initialThinkingLevel: options.initialThinkingLevel,
		knowledgeRuntime: options.knowledgeRuntime,
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
