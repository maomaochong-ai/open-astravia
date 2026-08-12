import { join } from "node:path";
import type { Message } from "@vetta/ai";
import type { ConversationScenario, InitializationRollbackTask, RuntimeResourceContext } from "@vetta/runtime-core";
import type { AgentFeatureDefinition, AgentProfile, ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import type { McpDeferredToolController } from "@vetta/runtime-mcp";
import { type CodingToolActivation, selectCodingToolRegistrations } from "@vetta/runtime-tools/coding";
import { CodingAgentSessionConfigurationState } from "../../host/session-configuration/configuration-state.js";
import { CodingAgentSessionExecutionRuntime } from "../../host/session-execution/execution-runtime.js";
import {
	CodingAgentMemoryRolloverOrchestrator,
	type CodingAgentMemoryRolloverRuntime,
	createCodingAgentMemoryRuntimeFeature,
} from "../../memory/index.js";
import type {
	CodingAgentPluginMcpRuntime,
	CodingAgentPluginRuntimeSource,
	CodingAgentRuntimeToolRegistration,
} from "../../runtime-contracts/index.js";
import type { CodingAgentTodoRuntime } from "../../work-state/contracts.js";
import { CodingAgentTodoRuntime as DefaultCodingAgentTodoRuntime } from "../../work-state/todo-runtime.js";
import {
	createCodingAgentTodoRuntimeFeature,
	createCodingAgentTodoRuntimeToolRegistration,
} from "../../work-state/todo-tool-feature.js";
import { createCodingAgentKnowledgeWriteOperations } from "../coding-agent-knowledge-runtime.js";
import type { CodingAgentRuntimeSessionOptions } from "../contracts/index.js";
import type { CodingAgentSessionResourceIndexes } from "../session-lifecycle/resource-lifecycle.js";
import { createCodingAgentAskUserQuestionFeature } from "../tool-surface/ask-user-question-feature.js";
import type { CodingAgentMcpSessionCoordinator } from "../tool-surface/mcp-session-coordinator.js";
import {
	createCodingAgentProductToolFeature,
	createCodingAgentProductToolRegistrations,
} from "../tool-surface/product-tools.js";
import type { CodingToolsRuntimeComposition } from "../tool-surface/runtime-tools-composition.js";
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
		agentMode?: string,
		activeToolNamesOverride?: readonly string[],
	) => CodingToolActivation;
	readonly trackMemoryRuntime: (runtime: CodingAgentMemoryRolloverRuntime) => void;
	readonly untrackMemoryRuntime: (runtime: CodingAgentMemoryRolloverRuntime) => void;
	readonly trackTodoRuntime: (runtime: CodingAgentTodoRuntime) => void;
	readonly untrackTodoRuntime: (runtime: CodingAgentTodoRuntime) => void;
	readonly deferRollback: (task: InitializationRollbackTask) => void;
}

export interface CodingAgentSessionPeripheralAssembly {
	readonly configurationState: CodingAgentSessionConfigurationState;
	readonly productToolRegistrations: readonly CodingAgentRuntimeToolRegistration[];
	readonly productToolFeature: AgentFeatureDefinition;
	readonly pluginRuntime?: CodingAgentPluginRuntimeSource;
	readonly pluginMcpRuntime?: CodingAgentPluginMcpRuntime;
	readonly mcpController?: McpDeferredToolController;
	readonly executionRuntime: CodingAgentSessionExecutionRuntime;
	readonly memoryRuntime?: CodingAgentMemoryRolloverRuntime;
	readonly todoRuntime: CodingAgentTodoRuntime;
	readonly todoRegistration: CodingAgentRuntimeToolRegistration;
	readonly todoEnabled: boolean;
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
	const productToolRegistrations = [
		...createCodingAgentProductToolRegistrations({
			cwd: options.sessionCwd,
			knowledgePageWriter:
				sessionOptions.knowledgePageWriter ?? createCodingAgentKnowledgeWriteOperations(profile.knowledgeRoot),
		}),
		...(sessionOptions.sessionRuntimeTools ?? []),
	];
	const productToolFeature = createCodingAgentProductToolFeature({
		registrations: productToolRegistrations,
		resolveActivation: (context) =>
			options.resolveActivation(
				context,
				configurationState.readAgentMode(),
				configurationState.readActiveToolNamesOverride(),
			),
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

	const executionRuntime = new CodingAgentSessionExecutionRuntime({
		cwd: options.sessionCwd,
		activation: options.activation,
		enableBackgroundTasks: sessionOptions.enableBackgroundTasks,
		initialMode: sessionOptions.executionMode,
		env: sessionOptions.env,
		sandboxHostPath: sessionOptions.sandboxHostPath,
		linuxBubblewrapPath: sessionOptions.linuxBubblewrapPath,
		macosSandboxExecPath: sessionOptions.macosSandboxExecPath,
		readSessionId: options.readSessionId,
		resolveToolEntry: (toolName) => options.codingTools.registry.resolve(toolName),
		resourceContext: options.resourceContext,
	});
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

	const memoryRuntimeOptions = {
		memoryFile: sessionOptions.memoryFile ?? join(options.sessionCwd, "MEMORY.md"),
		memoryCharLimit: sessionOptions.memoryCharLimit,
		cwd: options.sessionCwd,
	};
	const memoryRuntime = sessionOptions.memoryMode
		? (profile.createMemoryRolloverRuntime?.(memoryRuntimeOptions, sessionOptions) ??
			new CodingAgentMemoryRolloverOrchestrator(memoryRuntimeOptions))
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
	const todoRuntime = profile.createTodoRuntime?.(sessionOptions) ?? new DefaultCodingAgentTodoRuntime();
	options.trackTodoRuntime(todoRuntime);
	// Todo 状态是 Session 内的实时 UI 面板来源：每次变更都要立刻广播，
	// 否则宿主只能在重新订阅（切会话）时才看到列表。
	const unsubscribeTodoObservation = todoRuntime.subscribe((items) => {
		void options.resourceContext
			.reportObservation({
				type: "todo_update",
				items: items.map((item) => ({ ...item })),
				source: "tool",
			})
			.catch((error: unknown) => {
				console.warn("[coding-agent-runtime] failed to publish todo observation", error);
			});
	});
	options.deferRollback({
		id: "todo-runtime",
		rollback: async () => {
			try {
				unsubscribeTodoObservation();
				await todoRuntime.dispose();
			} finally {
				options.untrackTodoRuntime(todoRuntime);
			}
		},
	});
	if (sessionOptions.initialTodos && sessionOptions.initialTodos.length > 0) {
		todoRuntime.initializeTodoItems(sessionOptions.initialTodos, sessionOptions.initialTodoLockSource);
	}
	const todoRegistration = createCodingAgentTodoRuntimeToolRegistration(todoRuntime);
	const todoEnabled = selectCodingToolRegistrations([todoRegistration], options.activation).length > 0;
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
		...(todoEnabled ? [createCodingAgentTodoRuntimeFeature(todoRegistration)] : []),
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
		productToolRegistrations,
		productToolFeature,
		pluginRuntime,
		pluginMcpRuntime,
		mcpController,
		executionRuntime,
		memoryRuntime,
		todoRuntime,
		todoRegistration,
		todoEnabled,
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
