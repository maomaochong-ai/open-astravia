import type { Api, Model } from "@vetta/ai";
import type {
	ConversationScenario,
	GreenfieldRuntimeResources,
	RuntimeSessionAskUserQuestionCapability,
} from "@vetta/runtime-core";
import type { ConversationContinuationResult } from "@vetta/runtime-core/kernel";
import type { McpDeferredToolController } from "@vetta/runtime-mcp";
import { type CodingToolActivation, selectCodingToolRegistrations } from "@vetta/runtime-tools/coding";
import {
	CODING_AGENT_ASK_USER_QUESTION_TOOL_NAME,
	type CodingAgentContextRuntime,
	type CodingAgentMemoryRolloverRuntime,
	isCodingAgentAskUserQuestionEnabled,
} from "../adapters/runtime-core/greenfield.js";
import type { CodingAgentGreenfieldExtensionToolRuntime } from "../adapters/runtime-core/greenfield-extension-tool-runtime.js";
import type {
	CodingAgentPluginMcpRuntime,
	CodingAgentRuntimeToolRegistration,
	CodingAgentTodoRuntime,
} from "../runtime-contracts/index.js";
import type { GreenfieldSessionExecutionRuntime } from "./greenfield-session-execution-runtime.js";
import {
	GreenfieldBackgroundWorkController,
	type GreenfieldSessionConfigurationState,
} from "./greenfield-session-peripherals.js";
import type { GreenfieldSubagentRuntime } from "./greenfield-subagent-runtime.js";
import type { GreenfieldTurnCapabilitySessionAssembly } from "./greenfield-turn-capability-session-assembly.js";
import type { CodingToolsRuntimeComposition } from "./runtime-tools-composition.js";

export interface GreenfieldSessionConversationResources {
	readonly repository: GreenfieldRuntimeResources["repository"];
	readonly documentStore: GreenfieldRuntimeResources["conversationDocumentStore"];
	readonly continuationStore: NonNullable<GreenfieldRuntimeResources["conversationContinuationStore"]>;
	resolveConversationPath(sessionId: string): string;
	resolveSessionPath(sessionId: string): string | undefined;
}

export type GreenfieldSessionModelRuntimePort = Omit<GreenfieldRuntimeResources["modelRuntime"], "readCurrentModel"> & {
	readCurrentModel(): Model<Api>;
};

export interface GreenfieldSessionRuntimeResourcesOptions {
	readonly session: {
		readonly initialSessionId: string;
		readonly readSessionId: () => string;
		readonly cwd: string;
		readonly parentSessionPath?: string;
		readonly parentEntryId?: string;
	};
	readonly conversation: GreenfieldSessionConversationResources;
	readonly turnCapabilityAssembly: GreenfieldTurnCapabilitySessionAssembly;
	readonly modelRuntime: GreenfieldSessionModelRuntimePort;
	readonly todoRuntime: CodingAgentTodoRuntime;
	readonly contextRuntime: CodingAgentContextRuntime;
	readonly subagentRuntime?: GreenfieldSubagentRuntime;
	readonly executionRuntime: GreenfieldSessionExecutionRuntime;
	readonly configurationState: GreenfieldSessionConfigurationState;
	readonly pluginMcpRuntime?: CodingAgentPluginMcpRuntime;
	readonly extensionToolRuntime?: CodingAgentGreenfieldExtensionToolRuntime;
	readonly codingTools: CodingToolsRuntimeComposition;
	readonly productToolRegistrations: readonly CodingAgentRuntimeToolRegistration[];
	readonly todoToolRegistration: CodingAgentRuntimeToolRegistration;
	readonly todoEnabled: boolean;
	readonly memoryRuntime?: CodingAgentMemoryRolloverRuntime;
	readonly mcpController?: McpDeferredToolController;
	readonly activation: CodingToolActivation;
	readonly knowledgeAvailable: boolean;
	readonly backgroundTasksAvailable: boolean;
	readonly askUserQuestion?: RuntimeSessionAskUserQuestionCapability;
	readonly scenario: ConversationScenario;
	readonly refreshSessionMcp: (sessionId: string, reportPromptBoundary: boolean) => Promise<unknown>;
	readonly onConversationContinued: (result: ConversationContinuationResult) => Promise<void>;
	readonly dispose: () => Promise<void>;
}

/** 将产品 Session runtime 投影为 runtime-core 的 GreenfieldRuntimeResources 合同。 */
export function createGreenfieldSessionRuntimeResources(
	options: GreenfieldSessionRuntimeResourcesOptions,
): GreenfieldRuntimeResources {
	const stateActivation = createStateActivation(options);
	const pluginMcpRuntime = options.pluginMcpRuntime;
	return {
		sessionId: options.session.initialSessionId,
		repository: options.conversation.repository,
		conversationDocumentStore: options.conversation.documentStore,
		conversationContinuationStore: options.conversation.continuationStore,
		promptAdapter: {
			async intercept(request, context) {
				await options.refreshSessionMcp(options.session.readSessionId(), true);
				return options.turnCapabilityAssembly.promptAdapter.intercept(request, context);
			},
			async prepare(request, context) {
				const prepared = await options.turnCapabilityAssembly.promptAdapter.prepare(request, context);
				await options.todoRuntime.flush();
				return prepared;
			},
		},
		snapshotProvider: options.turnCapabilityAssembly.capabilities,
		modelRuntime: options.modelRuntime,
		documentParticipants: [
			options.todoRuntime,
			options.contextRuntime,
			...(options.subagentRuntime ? [options.subagentRuntime] : []),
		],
		todoController: options.todoRuntime,
		toolController: {
			readActiveToolNames: () => {
				const override = options.configurationState.readActiveToolNamesOverride();
				return override
					? override.filter((toolName) => options.turnCapabilityAssembly.readAvailableTools().has(toolName))
					: [
							...readActiveToolNames(
								options.codingTools,
								withAgentMode(stateActivation, options.configurationState.readAgentMode()),
								options.knowledgeAvailable,
								options.activation,
								options.mcpController,
							),
							...(options.extensionToolRuntime?.readActiveToolNames(
								withAgentMode(stateActivation, options.configurationState.readAgentMode()),
								options.session.readSessionId(),
							) ?? []),
						];
			},
			readAvailableTools: () => options.turnCapabilityAssembly.readAvailableTools(),
			setActiveToolNames: (toolNames) => options.configurationState.setActiveToolNamesOverride(toolNames),
		},
		createSessionPeripherals: (session) => ({
			hostInteraction: options.executionRuntime.hostInteraction,
			executionController: options.executionRuntime.createExecutionController(session),
			backgroundWorkController: new GreenfieldBackgroundWorkController(
				options.executionRuntime.backgroundService,
				options.subagentRuntime,
			),
			configurationController: options.configurationState.createController(
				session,
				pluginMcpRuntime
					? {
							reconfigureAgentPlugins: async (agentPlugins) => {
								await pluginMcpRuntime.reconfigure(agentPlugins);
							},
						}
					: undefined,
			),
		}),
		contextRuntime: options.contextRuntime,
		identity: {
			cwd: options.session.cwd,
			sessionPath: options.conversation.resolveSessionPath(options.session.initialSessionId),
			parentSessionPath: options.session.parentSessionPath,
			parentEntryId: options.session.parentEntryId,
		},
		stateSource: {
			read: () => readSessionState(options, stateActivation),
		},
		onConversationContinued: options.onConversationContinued,
		dispose: options.dispose,
	};
}

function readSessionState(options: GreenfieldSessionRuntimeResourcesOptions, stateActivation: CodingToolActivation) {
	const baseToolNames =
		options.turnCapabilityAssembly.readPluginActiveToolNames() ??
		readActiveToolNames(
			options.codingTools,
			withAgentMode(stateActivation, options.configurationState.readAgentMode()),
			options.knowledgeAvailable,
			options.activation,
			options.mcpController,
		);
	const executionTools = options.executionRuntime.readAvailableTools();
	const activeToolNames = [
		...baseToolNames.filter(
			(toolName) => !options.executionRuntime.ownsTool(toolName) || executionTools.has(toolName),
		),
		...selectCodingToolRegistrations(
			options.productToolRegistrations,
			withAgentMode(stateActivation, options.configurationState.readAgentMode()),
		).map(({ tool }) => tool.name),
		...(options.todoEnabled ? [options.todoToolRegistration.tool.name] : []),
		...(options.memoryRuntime ? [options.memoryRuntime.toolRegistration.tool.name] : []),
		...(options.subagentRuntime ? options.subagentRuntime.readTools().map(({ name }) => name) : []),
		...(options.askUserQuestion &&
		isCodingAgentAskUserQuestionEnabled({ capability: options.askUserQuestion, scenario: options.scenario })
			? [CODING_AGENT_ASK_USER_QUESTION_TOOL_NAME]
			: []),
		...(options.extensionToolRuntime?.readActiveToolNames(
			withAgentMode(stateActivation, options.configurationState.readAgentMode()),
			options.session.readSessionId(),
		) ?? []),
	];
	const contextWindow = options.modelRuntime.readCurrentModel().contextWindow;
	const contextUsage = options.contextRuntime.readUsage(contextWindow);
	const override = options.configurationState.readActiveToolNamesOverride();
	return {
		contextTokens: contextUsage.tokens,
		contextPercent: contextUsage.percent,
		contextWindow,
		activeToolNames: override
			? override.filter((toolName) => options.turnCapabilityAssembly.readAvailableTools().has(toolName))
			: [...new Set(activeToolNames)],
	};
}

function readActiveToolNames(
	tools: CodingToolsRuntimeComposition,
	activation: CodingToolActivation,
	knowledgeAvailable: boolean,
	baseActivation: CodingToolActivation,
	mcpController: McpDeferredToolController | undefined,
): string[] {
	const selected = selectCodingToolRegistrations(
		tools.registry.snapshot().registrations.filter(({ category, tool }) => {
			if (
				category === "kb-read" &&
				!(knowledgeAvailable && baseActivation.mode === "scope" && baseActivation.scope === "kb-processing")
			) {
				return false;
			}
			return !mcpController?.isManagedTool(tool.name) || mcpController.isToolVisible(tool.name);
		}),
		activation,
	).map(({ tool }) => tool.name);
	if (!mcpController?.isDeferred()) return selected;
	return [...selected, "tool_search"];
}

function createStateActivation(options: GreenfieldSessionRuntimeResourcesOptions): CodingToolActivation {
	if (options.activation.mode !== "scope") return options.activation;
	return {
		...options.activation,
		capabilities: new Set([
			...(options.activation.capabilities ?? []),
			...(options.backgroundTasksAvailable ? ["bg-tasks"] : []),
			...(options.knowledgeAvailable && options.activation.scope === "kb-processing" ? ["knowledge"] : []),
		]),
	};
}

function withAgentMode(activation: CodingToolActivation, agentMode: string | undefined): CodingToolActivation {
	return activation.mode === "scope" ? { ...activation, agentMode } : activation;
}
