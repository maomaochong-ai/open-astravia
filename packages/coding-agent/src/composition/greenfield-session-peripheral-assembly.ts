import { join } from "node:path";
import type { Message } from "@vetta/ai";
import type {
	ConversationScenario,
	GreenfieldRuntimeResourceContext,
	InitializationRollbackTask,
} from "@vetta/runtime-core";
import type { AgentFeatureDefinition, AgentProfile, ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import type { McpDeferredToolController } from "@vetta/runtime-mcp";
import { type CodingToolActivation, selectCodingToolRegistrations } from "@vetta/runtime-tools/coding";
import { createCodingAgentAskUserQuestionRuntimeFeature } from "../adapters/runtime-core/greenfield-ask-user-question-runtime.js";
import {
	createCodingAgentGreenfieldProductToolFeature,
	createCodingAgentGreenfieldProductToolRegistrations,
} from "../adapters/runtime-core/greenfield-product-tools-runtime.js";
import {
	createCodingAgentTodoRuntimeFeature,
	createCodingAgentTodoRuntimeToolRegistration,
	CodingAgentTodoRuntime as DefaultCodingAgentTodoRuntime,
} from "../adapters/runtime-core/greenfield-todo-runtime.js";
import {
	CodingAgentMemoryRolloverOrchestrator,
	type CodingAgentMemoryRolloverRuntime,
	createCodingAgentMemoryRuntimeFeature,
} from "../memory/index.js";
import type {
	CodingAgentPluginMcpRuntime,
	CodingAgentPluginRuntimeSource,
	CodingAgentRuntimeToolRegistration,
	CodingAgentTodoRuntime,
} from "../runtime-contracts/index.js";
import { createCodingAgentKnowledgeWriteOperations } from "./coding-agent-knowledge-runtime.js";
import type { CodingAgentRuntimeSessionOptions } from "./contracts/index.js";
import type { GreenfieldMcpSessionCoordinator } from "./greenfield-mcp-session-coordinator.js";
import { GreenfieldSessionExecutionRuntime } from "./greenfield-session-execution-runtime.js";
import type { GreenfieldSessionInitializationProfile } from "./greenfield-session-initialization-profile.js";
import { GreenfieldSessionConfigurationState } from "./greenfield-session-peripherals.js";
import type { GreenfieldSessionResourceIndexes } from "./greenfield-session-resource-lifecycle-assembly.js";
import type { CodingToolsRuntimeComposition } from "./runtime-tools-composition.js";

export interface GreenfieldSessionPeripheralAssemblyOptions {
	readonly profile: GreenfieldSessionInitializationProfile;
	readonly sessionOptions: CodingAgentRuntimeSessionOptions;
	readonly sessionCwd: string;
	readonly scenario: ConversationScenario;
	readonly activation: CodingToolActivation;
	readonly codingTools: CodingToolsRuntimeComposition;
	readonly indexes: GreenfieldSessionResourceIndexes;
	readonly mcpCoordinator: GreenfieldMcpSessionCoordinator;
	readonly resourceContext: GreenfieldRuntimeResourceContext;
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

export interface GreenfieldSessionPeripheralAssembly {
	readonly configurationState: GreenfieldSessionConfigurationState;
	readonly productToolRegistrations: readonly CodingAgentRuntimeToolRegistration[];
	readonly productToolFeature: AgentFeatureDefinition;
	readonly pluginRuntime?: CodingAgentPluginRuntimeSource;
	readonly pluginMcpRuntime?: CodingAgentPluginMcpRuntime;
	readonly mcpController?: McpDeferredToolController;
	readonly executionRuntime: GreenfieldSessionExecutionRuntime;
	readonly memoryRuntime?: CodingAgentMemoryRolloverRuntime;
	readonly todoRuntime: CodingAgentTodoRuntime;
	readonly todoRegistration: CodingAgentRuntimeToolRegistration;
	readonly todoEnabled: boolean;
	readonly baseProfile: AgentProfile;
}

/** 组装 Session 配置、Plugin/MCP、执行、Memory 与 Todo 等外设能力。 */
export async function createGreenfieldSessionPeripheralAssembly(
	options: GreenfieldSessionPeripheralAssemblyOptions,
): Promise<GreenfieldSessionPeripheralAssembly> {
	const { profile, sessionOptions } = options;
	const requestedPluginRuntime = createSessionPluginRuntime(sessionOptions);
	const configuredPluginRuntime = profile.createPluginRuntime?.(sessionOptions);
	if (requestedPluginRuntime && configuredPluginRuntime) {
		throw new Error("Greenfield session plugin capabilities conflict with createPluginRuntime");
	}
	const pluginRuntime = requestedPluginRuntime ?? configuredPluginRuntime;
	const configurationState = new GreenfieldSessionConfigurationState(sessionOptions.agentMode, () =>
		pluginRuntime?.readAgentPlugins(),
	);
	const productToolRegistrations = [
		...createCodingAgentGreenfieldProductToolRegistrations({
			cwd: options.sessionCwd,
			knowledgePageWriter:
				sessionOptions.knowledgePageWriter ?? createCodingAgentKnowledgeWriteOperations(profile.knowledgeRoot),
		}),
		...(sessionOptions.sessionRuntimeTools ?? []),
	];
	const productToolFeature = createCodingAgentGreenfieldProductToolFeature({
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

	const executionRuntime = new GreenfieldSessionExecutionRuntime({
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
	options.deferRollback({
		id: "todo-runtime",
		rollback: async () => {
			try {
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
		? createCodingAgentAskUserQuestionRuntimeFeature({
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
	};
}
