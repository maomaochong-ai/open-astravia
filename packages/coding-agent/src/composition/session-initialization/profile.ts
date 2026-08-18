import type { CodingAgentRuntimeCompositionOptions } from "../contracts/index.js";

export type CodingAgentSessionInitializationProfile = Pick<
	CodingAgentRuntimeCompositionOptions,
	| "additionalHookAdapterFactories"
	| "agentDir"
	| "createCompactionExtensionRuntime"
	| "createContextRuntime"
	| "createMemoryRolloverRuntime"
	| "createPluginMcpRuntime"
	| "createPluginRuntime"
	| "createPromptRuntimeSources"
	| "createSessionExecutionEnvironment"
	| "createPromptResourceResolver"
	| "createSessionExtensionDefinitions"
	| "createSubagentChildFactory"
	| "createSubagentId"
	| "createSystemPromptOptionsResolver"
	| "createTodoRuntime"
	| "enableSubagents"
	| "generateCompaction"
	| "hookConfigLayers"
	| "initialModel"
	| "initialThinkingLevel"
	| "knowledgeRuntime"
	| "maxStopHookContinuations"
	| "modelInputImageProcessor"
	| "ocrMaxConcurrent"
	| "promptResourceSource"
	| "promptSettingsSource"
	| "resolveCompactionSettings"
	| "resolvePromptResource"
	| "resolveSystemPromptOptions"
	| "subagentMaxConcurrent"
	| "subagentTypeRegistry"
	| "subagentPathPort"
	| "systemPromptAdvertisedToolNames"
	| "workspaceFacts"
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
		createContextRuntime: options.createContextRuntime,
		createMemoryRolloverRuntime: options.createMemoryRolloverRuntime,
		createPluginMcpRuntime: options.createPluginMcpRuntime,
		createPluginRuntime: options.createPluginRuntime,
		createPromptRuntimeSources: options.createPromptRuntimeSources,
		createSessionExecutionEnvironment: options.createSessionExecutionEnvironment,
		createPromptResourceResolver: options.createPromptResourceResolver,
		createSessionExtensionDefinitions: options.createSessionExtensionDefinitions,
		createSubagentChildFactory: options.createSubagentChildFactory,
		createSubagentId: options.createSubagentId,
		createSystemPromptOptionsResolver: options.createSystemPromptOptionsResolver,
		createTodoRuntime: options.createTodoRuntime,
		enableSubagents: options.enableSubagents,
		generateCompaction: options.generateCompaction,
		hookConfigLayers: options.hookConfigLayers,
		initialModel: options.initialModel,
		initialThinkingLevel: options.initialThinkingLevel,
		knowledgeRuntime: options.knowledgeRuntime,
		maxStopHookContinuations: options.maxStopHookContinuations,
		modelInputImageProcessor: options.modelInputImageProcessor,
		ocrMaxConcurrent: options.ocrMaxConcurrent,
		promptResourceSource: options.promptResourceSource,
		promptSettingsSource: options.promptSettingsSource,
		resolveCompactionSettings: options.resolveCompactionSettings,
		resolvePromptResource: options.resolvePromptResource,
		resolveSystemPromptOptions: options.resolveSystemPromptOptions,
		subagentMaxConcurrent: options.subagentMaxConcurrent,
		subagentTypeRegistry: options.subagentTypeRegistry,
		subagentPathPort: options.subagentPathPort,
		systemPromptAdvertisedToolNames: options.systemPromptAdvertisedToolNames,
		workspaceFacts: options.workspaceFacts,
	};
}
