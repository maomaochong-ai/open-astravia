import type { Message } from "@vetta/ai";
import type { ConversationScenario, InitializationRollbackTask, RuntimeResourceContext } from "@vetta/runtime-core";
import type { AgentFeatureDefinition, AgentProfile, ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import { SessionExtensionComposition, sessionExtensionObservation } from "@vetta/runtime-core/session-extensions";
import type { McpDeferredToolController } from "@vetta/runtime-mcp";
import type { CodingToolActivation } from "@vetta/runtime-tools";
import { CodingAgentSessionExecutionRuntime } from "../../execution/session/runtime.js";
import { createCodingAgentAskUserQuestionFeature } from "../../features/ask-user-question/index.js";
import type { CodingAgentTodoRuntime } from "../../features/todo/contracts.js";
import {
	CODING_AGENT_TODO_RUNTIME,
	createCodingAgentTodoSessionExtension,
} from "../../features/todo/todo-session-extension.js";
import { CODING_AGENT_TODO_OBSERVATION } from "../../features/todo/todo-session-extension-contract.js";
import { CodingAgentSessionConfigurationState } from "../../host/session-configuration/configuration-state.js";
import { type CodingAgentMemoryRolloverRuntime, createCodingAgentMemoryRuntimeFeature } from "../../memory/index.js";
import type {
	CodingAgentPluginMcpRuntime,
	CodingAgentPluginRuntimeSource,
	CodingAgentRuntimeToolRegistration,
} from "../../runtime-contracts/index.js";
import { getCodingAgentOcrExecutionGate } from "../../tool-policy/ocr-execution-gate.js";
import type { CodingAgentRuntimeSessionOptions } from "../contracts/index.js";
import type { CodingAgentSessionResourceIndexes } from "../session-lifecycle/resource-lifecycle.js";
import type { CodingAgentMcpSessionCoordinator } from "../tool-surface/mcp-session-coordinator.js";
import type { CodingToolsRuntimeComposition } from "../tool-surface/runtime-tools-composition.js";
import {
	createCodingAgentSpecializedToolFeature,
	createCodingAgentSpecializedToolRegistrations,
} from "../tool-surface/specialized-tools.js";
import type { CodingAgentSessionInitializationProfile } from "./profile.js";

export interface CodingAgentSessionPeripheralAssemblyOptions {
	readonly profile: CodingAgentSessionInitializationProfile;
	readonly sessionOptions: CodingAgentRuntimeSessionOptions;
	readonly sessionCwd: string;
	readonly scenario: ConversationScenario;
	readonly activation: CodingToolActivation;
	readonly codingTools: CodingToolsRuntimeComposition;
	readonly indexes: CodingAgentSessionResourceIndexes;
	readonly mcpCoordinator: CodingAgentMcpSessionCoordinator;
	readonly resourceContext: RuntimeResourceContext;
	readonly readSessionId: () => string;
	readonly resolveActivation: (
		context: ModelCallContributionContext,
		activeToolNamesOverride?: readonly string[],
	) => CodingToolActivation;
	readonly trackMemoryRuntime: (runtime: CodingAgentMemoryRolloverRuntime) => void;
	readonly untrackMemoryRuntime: (runtime: CodingAgentMemoryRolloverRuntime) => void;
	readonly trackSessionExtensionComposition: (composition: SessionExtensionComposition) => void;
	readonly untrackSessionExtensionComposition: (composition: SessionExtensionComposition) => void;
	readonly deferRollback: (task: InitializationRollbackTask) => void;
}

export interface CodingAgentSessionPeripheralAssembly {
	readonly configurationState: CodingAgentSessionConfigurationState;
	readonly specializedToolRegistrations: readonly CodingAgentRuntimeToolRegistration[];
	readonly specializedToolFeature: AgentFeatureDefinition;
	readonly pluginRuntime?: CodingAgentPluginRuntimeSource;
	readonly pluginMcpRuntime?: CodingAgentPluginMcpRuntime;
	readonly mcpController?: McpDeferredToolController;
	readonly executionRuntime: CodingAgentSessionExecutionRuntime;
	readonly memoryRuntime?: CodingAgentMemoryRolloverRuntime;
	readonly todoRuntime: CodingAgentTodoRuntime;
	readonly todoRegistration: CodingAgentRuntimeToolRegistration;
	readonly todoEnabled: boolean;
	readonly sessionExtensions: SessionExtensionComposition;
	readonly baseProfile: AgentProfile;
}

/** 组装 Session 配置、Plugin/MCP、执行、Memory 与 Todo 等外设能力。 */
export async function createCodingAgentSessionPeripheralAssembly(
	options: CodingAgentSessionPeripheralAssemblyOptions,
): Promise<CodingAgentSessionPeripheralAssembly> {
	const { profile, sessionOptions } = options;
	const requestedPluginRuntime = createSessionPluginRuntime(sessionOptions);
	const configuredPluginRuntime = profile.createPluginRuntime?.(sessionOptions);
	if (requestedPluginRuntime && configuredPluginRuntime) {
		throw new Error("Session plugin capabilities conflict with createPluginRuntime");
	}
	const pluginRuntime = requestedPluginRuntime ?? configuredPluginRuntime;
	const configurationState = new CodingAgentSessionConfigurationState(sessionOptions.agentMode, () =>
		pluginRuntime?.readAgentPlugins(),
	);
	const platformSpecializedToolRegistrations = await options.codingTools.createSpecializedToolRegistrations?.({
		cwd: options.sessionCwd,
		agentDir: profile.agentDir,
		scenario: options.scenario,
		ocrExecutionGate: getCodingAgentOcrExecutionGate(profile.ocrMaxConcurrent),
	});
	const specializedToolRegistrations = [
		...createCodingAgentSpecializedToolRegistrations({
			platformRegistrations: platformSpecializedToolRegistrations,
			knowledgePageWriter: sessionOptions.knowledgePageWriter ?? profile.knowledgeRuntime?.write,
		}),
		...(sessionOptions.sessionRuntimeTools ?? []),
	];
	const specializedToolFeature = createCodingAgentSpecializedToolFeature({
		registrations: specializedToolRegistrations,
		resolveActivation: (context) =>
			options.resolveActivation(context, configurationState.readActiveToolNamesOverride()),
	});
	options.indexes.configurationStates.set(options.readSessionId(), configurationState);
	options.deferRollback({
		id: "configuration-state-binding",
		rollback: () => {
			options.indexes.configurationStates.unbind(options.readSessionId(), configurationState);
		},
	});

	const pluginMcpRuntime = await profile.createPluginMcpRuntime?.({
		cwd: options.sessionCwd,
		agentDir: profile.agentDir,
		sessionOptions,
	});
	if (pluginMcpRuntime) {
		options.deferRollback({
			id: "plugin-mcp-runtime",
			rollback: async () => {
				try {
					await pluginMcpRuntime.dispose();
				} finally {
					options.indexes.pluginMcpRuntimes.unbind(options.readSessionId(), pluginMcpRuntime);
				}
			},
		});
		await pluginMcpRuntime.reconfigure(configurationState.readAgentPlugins());
		options.indexes.pluginMcpRuntimes.set(options.readSessionId(), pluginMcpRuntime);
	}
	const mcpController = options.mcpCoordinator.createSessionController({
		sessionId: sessionOptions.sessionId,
		activation: options.activation,
		pluginRuntime: pluginMcpRuntime,
	});
	if (mcpController) {
		options.indexes.mcpControllers.set(options.readSessionId(), mcpController);
		options.deferRollback({
			id: "mcp-controller-binding",
			rollback: () => {
				options.indexes.mcpControllers.unbind(options.readSessionId(), mcpController);
			},
		});
	}

	const executionEnvironment = await profile.createSessionExecutionEnvironment({
		cwd: options.sessionCwd,
		agentDir: profile.agentDir,
		scenario: options.scenario,
		env: sessionOptions.env,
	});
	let executionRuntime: CodingAgentSessionExecutionRuntime;
	try {
		executionRuntime = new CodingAgentSessionExecutionRuntime({
			cwd: options.sessionCwd,
			activation: options.activation,
			environment: executionEnvironment,
			enableBackgroundTasks: sessionOptions.enableBackgroundTasks,
			initialMode: sessionOptions.executionMode,
			sandboxHostPath: sessionOptions.sandboxHostPath,
			linuxBubblewrapPath: sessionOptions.linuxBubblewrapPath,
			macosSandboxExecPath: sessionOptions.macosSandboxExecPath,
			readSessionId: options.readSessionId,
			resolveToolEntry: (toolName) => options.codingTools.registry.resolve(toolName),
			resourceContext: options.resourceContext,
		});
	} catch (error) {
		await executionEnvironment.dispose();
		throw error;
	}
	options.indexes.executionRuntimes.set(options.readSessionId(), executionRuntime);
	options.deferRollback({
		id: "execution-runtime",
		rollback: async () => {
			try {
				await executionRuntime.dispose();
			} finally {
				options.indexes.executionRuntimes.unbind(options.readSessionId(), executionRuntime);
			}
		},
	});

	const memoryRuntime = sessionOptions.memoryMode
		? profile.createMemoryRolloverRuntime
			? profile.createMemoryRolloverRuntime(
					{
						cwd: options.sessionCwd,
						memoryFile: sessionOptions.memoryFile,
						memoryCharLimit: sessionOptions.memoryCharLimit,
					},
					sessionOptions,
				)
			: (() => {
					throw new Error("Memory mode requires an explicit createMemoryRolloverRuntime host factory");
				})()
		: undefined;
	if (memoryRuntime) {
		options.trackMemoryRuntime(memoryRuntime);
		options.deferRollback({
			id: "memory-runtime",
			rollback: () => {
				memoryRuntime.dispose();
				options.untrackMemoryRuntime(memoryRuntime);
			},
		});
	}
	const createTodoRuntime = profile.createTodoRuntime;
	const additionalExtensions = await profile.createSessionExtensionDefinitions?.(sessionOptions);
	const sessionExtensions = await SessionExtensionComposition.create({
		definitions: [
			createCodingAgentTodoSessionExtension({
				activation: options.activation,
				createRuntime: createTodoRuntime ? () => createTodoRuntime(sessionOptions) : undefined,
				initialItems: sessionOptions.initialTodos,
				initialLockSource: sessionOptions.initialTodoLockSource,
				reportUpdate: (items) =>
					options.resourceContext.reportObservation({
						...sessionExtensionObservation(CODING_AGENT_TODO_OBSERVATION, items),
						source: "tool",
					}),
			}),
			...(additionalExtensions ?? []),
		],
	});
	options.trackSessionExtensionComposition(sessionExtensions);
	options.deferRollback({
		id: "session-extensions",
		rollback: async () => {
			await sessionExtensions.dispose();
			options.untrackSessionExtensionComposition(sessionExtensions);
		},
	});
	const todoExtension = sessionExtensions.services.require(CODING_AGENT_TODO_RUNTIME);
	const todoRuntime = todoExtension.runtime;
	const todoRegistration = todoExtension.toolRegistration;
	const todoEnabled = todoExtension.toolEnabled;
	const askUserQuestionFeature = sessionOptions.askUserQuestion
		? createCodingAgentAskUserQuestionFeature({
				capability: sessionOptions.askUserQuestion,
				scenario: options.scenario,
			})
		: undefined;
	const features = [
		...options.codingTools.profile.features,
		executionRuntime.feature,
		...(sessionOptions.forkContextMessages?.length
			? [createForkContextFeature(sessionOptions.forkContextMessages)]
			: []),
		...sessionExtensions.features,
		...(memoryRuntime ? [createCodingAgentMemoryRuntimeFeature(memoryRuntime.toolRegistration)] : []),
		...(askUserQuestionFeature ? [askUserQuestionFeature] : []),
		...(mcpController ? [mcpController.createFeature({ includePromptInstruction: false })] : []),
	];
	const baseProfile: AgentProfile = {
		...options.codingTools.profile,
		salvageTextToolCalls: ["progress", "todo"],
		features,
	};

	return {
		configurationState,
		specializedToolRegistrations,
		specializedToolFeature,
		pluginRuntime,
		pluginMcpRuntime,
		mcpController,
		executionRuntime,
		memoryRuntime,
		todoRuntime,
		todoRegistration,
		todoEnabled,
		sessionExtensions,
		baseProfile,
	};
}

function createForkContextFeature(messages: readonly Message[]): AgentFeatureDefinition {
	const snapshot = [...messages];
	return {
		id: "coding-agent-parent-context",
		prepare: async () => ({
			contribute: async () => ({
				contextProviders: [
					{
						id: "coding-agent-parent-context",
						provide: async () => snapshot,
					},
				],
			}),
			dispose: async () => {},
		}),
	};
}

function createSessionPluginRuntime(
	sessionOptions: CodingAgentRuntimeSessionOptions,
): CodingAgentPluginRuntimeSource | undefined {
	if (
		sessionOptions.agentPlugins === undefined &&
		sessionOptions.invokePluginTool === undefined &&
		sessionOptions.invokePluginContinuation === undefined &&
		sessionOptions.invokePluginSystemPrompt === undefined
	) {
		return undefined;
	}
	return {
		readAgentPlugins: () => sessionOptions.agentPlugins,
		invokeTool: sessionOptions.invokePluginTool,
		invokeContinuation: sessionOptions.invokePluginContinuation,
		invokeSystemPrompt: sessionOptions.invokePluginSystemPrompt,
		handlerLeaseProvider: sessionOptions.pluginTurnHandlerLeaseProvider,
	};
}
