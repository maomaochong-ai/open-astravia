import type { Message } from "@vetta/ai";
import { createEcosystemHookRuntime, type EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import {
	type ConversationScenario,
	type InitializationRollbackTask,
	RuntimeModel,
	type RuntimeResourceContext,
} from "@vetta/runtime-core";
import { CodingAgentContextRuntime } from "../../adapters/runtime-core/context-runtime/index.js";
import type { CodingAgentExtensionRunAdapter } from "../../adapters/runtime-core/extension-run-adapter.js";
import type { CodingAgentRuntimeModelAdapter } from "../../adapters/runtime-core/model-runtime-adapter.js";
import { type CodingAgentMemoryController, CodingAgentSessionMemoryController } from "../../memory/index.js";
import type { CodingAgentRuntimeSessionOptions } from "../contracts/index.js";
import type { CodingAgentSubagentRuntime } from "../subagent/runtime.js";
import {
	type CodingAgentSubagentChildComposition,
	type CodingAgentSubagentChildCompositionRequest,
	createCodingAgentSubagentSessionAssembly,
} from "../subagent/session-assembly.js";
import type { CodingAgentMcpSessionCoordinator } from "../tool-surface/mcp-session-coordinator.js";
import type { CodingAgentSessionPeripheralAssembly } from "./peripheral-assembly.js";
import type { CodingAgentSessionInitializationProfile } from "./profile.js";

export interface CodingAgentSessionContextAssemblyOptions {
	readonly profile: CodingAgentSessionInitializationProfile;
	readonly sessionOptions: CodingAgentRuntimeSessionOptions;
	readonly sessionCwd: string;
	readonly scenario: ConversationScenario;
	readonly resourceContext: RuntimeResourceContext;
	readonly peripherals: CodingAgentSessionPeripheralAssembly;
	readonly modelAdapter: CodingAgentRuntimeModelAdapter;
	readonly extensionEvents: CodingAgentExtensionRunAdapter;
	readonly mcpCoordinator: CodingAgentMcpSessionCoordinator;
	readonly readSessionId: () => string;
	readonly resolveConversationPath: (sessionId: string) => string;
	readonly readConversationModelMessages: (sessionId: string) => Promise<readonly Message[]>;
	readonly createChildComposition: (
		request: CodingAgentSubagentChildCompositionRequest,
	) => Promise<CodingAgentSubagentChildComposition>;
	readonly trackContextRuntime: (runtime: CodingAgentContextRuntime) => void;
	readonly untrackContextRuntime: (runtime: CodingAgentContextRuntime) => void;
	readonly deferRollback: (task: InitializationRollbackTask) => void;
}

export interface CodingAgentSessionContextAssembly {
	readonly modelRuntime: RuntimeModel;
	readonly memoryController?: CodingAgentMemoryController;
	readonly hookRuntime: EcosystemHookRuntime;
	readonly contextRuntime: CodingAgentContextRuntime;
	readonly subagentRuntime?: CodingAgentSubagentRuntime;
}

/** 组装 Session Model、Hook、Context/Compaction 与 Subagent 上下文能力。 */
export function createCodingAgentSessionContextAssembly(
	options: CodingAgentSessionContextAssemblyOptions,
): CodingAgentSessionContextAssembly {
	const { peripherals, profile, sessionOptions } = options;
	const modelRuntime = new RuntimeModel({
		initialModel: sessionOptions.model ?? profile.initialModel,
		initialThinkingLevel: sessionOptions.thinkingLevel ?? profile.initialThinkingLevel,
		catalog: options.modelAdapter,
		credentials: options.modelAdapter,
	});
	const memoryController = peripherals.memoryRuntime
		? new CodingAgentSessionMemoryController({
				runtime: peripherals.memoryRuntime,
				readMessages: () => options.readConversationModelMessages(options.readSessionId()),
				readModel: () => modelRuntime.readCurrentModel(),
				resolveApiKey: (model) => modelRuntime.resolveApiKey(model),
			})
		: undefined;
	const hookRuntime = createEcosystemHookRuntime({
		host: {
			cwd: options.sessionCwd,
			getSessionId: options.readSessionId,
			getTranscriptPath: () => options.resolveConversationPath(options.readSessionId()),
			getModelId: () => modelRuntime.readCurrentModel().id,
			abortCurrentRun: options.resourceContext.abortCurrentRun,
			recordAdditionalContexts: (contexts) => {
				options.resourceContext.contextAppender.append(
					contexts.map((content) => ({
						type: "ecosystem-hook-context",
						content: [{ type: "text", text: content }],
						modelVisible: true,
						display: false,
					})),
				);
			},
		},
		initialSessionStartSource: options.resourceContext.operation === "create" ? "startup" : "resume",
		additionalAdapterFactories: profile.additionalHookAdapterFactories,
		configLayers: profile.hookConfigLayers,
		maxStopContinuations: profile.maxStopHookContinuations,
	});
	const contextRuntime = new CodingAgentContextRuntime({
		hookRuntime,
		resolveApiKey: (model) => modelRuntime.resolveApiKey(model),
		resolveSettings: profile.resolveCompactionSettings,
		generateCompaction: profile.generateCompaction,
		extensionRuntime: profile.createCompactionExtensionRuntime?.(sessionOptions),
		memoryRollover: peripherals.memoryRuntime,
		transformAgentContext: (messages) => options.extensionEvents.transformContext(messages),
	});
	options.trackContextRuntime(contextRuntime);
	options.deferRollback({
		id: "context-runtime",
		rollback: () => {
			contextRuntime.dispose();
			options.untrackContextRuntime(contextRuntime);
		},
	});
	const subagentRuntime = createCodingAgentSubagentSessionAssembly({
		enabled: profile.enableSubagents === true,
		maxConcurrent: profile.subagentMaxConcurrent,
		cwd: options.sessionCwd,
		scenario: options.scenario,
		readParentSessionId: options.readSessionId,
		readParentSessionPath: () => options.resolveConversationPath(options.readSessionId()),
		readParentMessages: () => options.readConversationModelMessages(options.readSessionId()),
		readModel: () => modelRuntime.readCurrentModel(),
		readThinkingLevel: () => modelRuntime.readThinkingLevel(),
		readInheritedMcpView: () => options.mcpCoordinator.readInheritedToolView(peripherals.pluginMcpRuntime),
		typeRegistry: profile.subagentTypeRegistry,
		createChildFactory: profile.createSubagentChildFactory,
		createChildComposition: options.createChildComposition,
		hookRuntime,
		resourceContext: options.resourceContext,
	});
	if (subagentRuntime) {
		options.deferRollback({
			id: "subagent-runtime",
			rollback: () => subagentRuntime.dispose(),
		});
	}
	return {
		modelRuntime,
		memoryController,
		hookRuntime,
		contextRuntime,
		subagentRuntime,
	};
}
