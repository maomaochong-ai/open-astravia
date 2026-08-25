import type { Api, Model } from "@vetta/ai";
import type {
	ConversationScenario,
	RuntimeResources,
	RuntimeSessionAskUserQuestionCapability,
	RuntimeSessionExtensionHost,
} from "@vetta/runtime-core";
import type { ConversationContinuationResult } from "@vetta/runtime-core/kernel";
import type { SessionExtensionComposition } from "@vetta/runtime-core/session-extensions";
import type { McpDeferredToolController } from "@vetta/runtime-mcp";
import { type CodingToolActivation, selectCodingToolRegistrations } from "@vetta/runtime-tools";
import { CodingAgentBackgroundWorkController } from "../../execution/background/work-controller.js";
import type { CodingAgentSessionExecutionRuntime } from "../../execution/session/runtime.js";
import type { CodingAgentExtensionToolRuntime } from "../../extensions/runtime/extension-tool-runtime.js";
import {
	CODING_AGENT_ASK_USER_QUESTION_TOOL_NAME,
	isCodingAgentAskUserQuestionEnabled,
} from "../../features/ask-user-question/index.js";
import type { CodingAgentSessionConfigurationState } from "../../host/session-configuration/configuration-state.js";
import type { CodingAgentMemoryRolloverRuntime } from "../../memory/index.js";
import type {
	CodingAgentContextRuntime,
	CodingAgentPluginMcpRuntime,
	CodingAgentRuntimeToolRegistration,
} from "../../runtime-contracts/index.js";
import type { CodingAgentSubagentRuntime } from "../subagent/runtime.js";
import type { CodingToolsRuntimeComposition } from "../tool-surface/runtime-tools-composition.js";
import type { CodingAgentTurnCapabilitySessionAssembly } from "../turn/capability-session-assembly.js";

export interface CodingAgentSessionConversationResources {
	readonly repository: RuntimeResources["repository"];
	readonly documentStore: RuntimeResources["conversationDocumentStore"];
	readonly continuationStore: NonNullable<RuntimeResources["conversationContinuationStore"]>;
	resolveConversationPath(sessionId: string): string;
	resolveSessionDirectory(sessionId: string): string | undefined;
	resolveSessionPath(sessionId: string): string | undefined;
}

export type CodingAgentSessionModelRuntimePort = Omit<RuntimeResources["modelRuntime"], "readCurrentModel"> & {
	readCurrentModel(): Model<Api>;
};

export interface CodingAgentSessionRuntimeResourcesOptions {
	readonly session: {
		readonly initialSessionId: string;
		readonly readSessionId: () => string;
		readonly cwd: string;
		readonly parentSessionPath?: string;
		readonly parentEntryId?: string;
	};
	readonly conversation: CodingAgentSessionConversationResources;
	readonly turnCapabilityAssembly: CodingAgentTurnCapabilitySessionAssembly;
	/** RuntimeAgentSession 提供的唯一能力 generation 来源。 */
	readonly capabilitySnapshotProvider: RuntimeResources["snapshotProvider"];
	readonly modelRuntime: CodingAgentSessionModelRuntimePort;
	readonly sessionExtensions: SessionExtensionComposition;
	readonly contextRuntime: CodingAgentContextRuntime;
	readonly subagentRuntime?: CodingAgentSubagentRuntime;
	readonly executionRuntime: CodingAgentSessionExecutionRuntime;
	readonly configurationState: CodingAgentSessionConfigurationState;
	readonly pluginMcpRuntime?: CodingAgentPluginMcpRuntime;
	readonly extensionToolRuntime?: CodingAgentExtensionToolRuntime;
	readonly codingTools: CodingToolsRuntimeComposition;
	readonly specializedToolRegistrations: readonly CodingAgentRuntimeToolRegistration[];
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

/** 将产品 Session runtime 投影为 runtime-core 的 RuntimeResources 合同。 */
export function createCodingAgentSessionRuntimeResources(
	options: CodingAgentSessionRuntimeResourcesOptions,
): RuntimeResources {
	const stateActivation = createStateActivation(options);
	const pluginMcpRuntime = options.pluginMcpRuntime;
	const extensionHost = createSessionExtensionHost(options.sessionExtensions);
	const snapshotProvider: RuntimeResources["snapshotProvider"] = {
		async acquire(context) {
			// External catalogs publish first; only then may the capability composition
			// capture one immutable Turn generation.
			await options.refreshSessionMcp(options.session.readSessionId(), true);
			return options.capabilitySnapshotProvider.acquire(context);
		},
	};
	return {
		sessionId: options.session.initialSessionId,
		repository: options.conversation.repository,
		conversationDocumentStore: options.conversation.documentStore,
		conversationContinuationStore: options.conversation.continuationStore,
		promptAdapter: options.turnCapabilityAssembly.promptAdapter,
		snapshotProvider,
		modelRuntime: options.modelRuntime,
		documentParticipants: [...options.sessionExtensions.documentParticipants, options.contextRuntime],
		extensionHost,
		toolController: {
			readActiveToolNames: () => {
				const override = options.configurationState.readActiveToolNamesOverride();
				return override
					? override.filter((toolName) => options.turnCapabilityAssembly.readAvailableTools().has(toolName))
					: [
							...readActiveToolNames(
								options.codingTools,
								stateActivation,
								options.knowledgeAvailable,
								options.activation,
								options.mcpController,
							),
							...(options.extensionToolRuntime?.readActiveToolNames(
								stateActivation,
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
			backgroundWorkController: new CodingAgentBackgroundWorkController(
				options.executionRuntime.backgroundService,
				options.subagentRuntime,
			),
			configurationController: options.configurationState.createController(session, {
				reconfigureAgentPlugins: async (agentPlugins) => {
					await pluginMcpRuntime?.reconfigure(agentPlugins);
					await options.turnCapabilityAssembly.reconfigureAgentPluginSkills(agentPlugins);
				},
			}),
		}),
		contextRuntime: options.contextRuntime,
		identity: {
			cwd: options.session.cwd,
			sessionDirectory: options.conversation.resolveSessionDirectory(options.session.initialSessionId),
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

function createSessionExtensionHost(extensions: SessionExtensionComposition): RuntimeSessionExtensionHost {
	return {
		hasEndpoint: (token) => extensions.hasEndpoint(token),
		invoke: (token, input, signal) => extensions.invoke(token, input, signal),
		invokeSync: (token, input, signal) => extensions.invokeSync(token, input, signal),
		readInitialObservations: () =>
			extensions.readInitialObservations().map((observation) => ({ ...observation, source: "agent" })),
	};
}

function readSessionState(options: CodingAgentSessionRuntimeResourcesOptions, stateActivation: CodingToolActivation) {
	const baseToolNames =
		options.turnCapabilityAssembly.readPluginActiveToolNames() ??
		readActiveToolNames(
			options.codingTools,
			stateActivation,
			options.knowledgeAvailable,
			options.activation,
			options.mcpController,
		);
	const executionTools = options.executionRuntime.readAvailableTools();
	const activeToolNames = [
		...baseToolNames.filter(
			(toolName) => !options.executionRuntime.ownsTool(toolName) || executionTools.has(toolName),
		),
		...selectCodingToolRegistrations(options.specializedToolRegistrations, stateActivation).map(
			({ tool }) => tool.name,
		),
		...(options.todoEnabled ? [options.todoToolRegistration.tool.name] : []),
		...(options.memoryRuntime ? [options.memoryRuntime.toolRegistration.tool.name] : []),
		...(options.subagentRuntime ? options.subagentRuntime.readTools().map(({ name }) => name) : []),
		...(options.askUserQuestion &&
		isCodingAgentAskUserQuestionEnabled({ capability: options.askUserQuestion, scenario: options.scenario })
			? [CODING_AGENT_ASK_USER_QUESTION_TOOL_NAME]
			: []),
		...(options.extensionToolRuntime?.readActiveToolNames(stateActivation, options.session.readSessionId()) ?? []),
	];
	const contextWindow = options.modelRuntime.readCurrentModel().contextWindow;
	const contextUsage = options.contextRuntime.readUsage(contextWindow);
	const override = options.configurationState.readActiveToolNamesOverride();
	return {
		contextTokens: contextUsage.tokens,
		contextPercent: contextUsage.percent,
		contextWindow,
		...(contextUsage.composition ? { contextComposition: contextUsage.composition } : {}),
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

function createStateActivation(options: CodingAgentSessionRuntimeResourcesOptions): CodingToolActivation {
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
