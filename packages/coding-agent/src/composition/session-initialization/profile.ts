import type { CodingAgentRuntimeCompositionOptions } from "../contracts/index.js";

export type CodingAgentSessionInitializationProfile = Pick<
	CodingAgentRuntimeCompositionOptions,
	| "additionalHookAdapterFactories"
	| "createSessionHookAdapterFactories"
	| "activation"
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
	| "sessionExtensionFunctions"
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
	| "resolveModePrompt"
	| "resolvePromptResource"
	| "resolveSystemPromptOptions"
	| "subagentMaxConcurrent"
	| "subagentTypeRegistry"
	| "subagentPathPort"
	| "subagentWorkspacePort"
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
		createSessionHookAdapterFactories: options.createSessionHookAdapterFactories,
		activation: options.activation,
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
		sessionExtensionFunctions: options.sessionExtensionFunctions,
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
		resolveModePrompt: options.resolveModePrompt,
		resolvePromptResource: options.resolvePromptResource,
		resolveSystemPromptOptions: options.resolveSystemPromptOptions,
		subagentMaxConcurrent: options.subagentMaxConcurrent,
		subagentTypeRegistry: options.subagentTypeRegistry,
		subagentPathPort: options.subagentPathPort,
		subagentWorkspacePort: options.subagentWorkspacePort,
		systemPromptAdvertisedToolNames: options.systemPromptAdvertisedToolNames,
		workspaceFacts: options.workspaceFacts,
	};
}
