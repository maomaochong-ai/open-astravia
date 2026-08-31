import type { Message } from "@vetta/ai";
import { createEcosystemHookRuntime, type EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import {
	type InitializationRollbackTask,
	RuntimeModel,
	type RuntimeObservationPublisher,
	type RuntimeResourceContext,
} from "@vetta/runtime-core";
import type { CodingAgentRuntimeModelAdapter } from "../../adapters/runtime-core/model-runtime-adapter.js";
import { allowsAgentResource } from "../../agent-configuration/resource-selection.js";
import { AGENT_SESSION_CONFIGURATION } from "../../agent-configuration/session-configuration-extension.js";
import { createDefaultCodingAgentContextRuntime } from "../../compaction/runtime/index.js";
import type { CodingAgentExtensionRunBridge } from "../../extensions/runtime/extension-run-bridge.js";
import { CodingAgentSessionAssistanceRuntime } from "../../features/session-assistance/session-assistance-runtime.js";
import { CODING_AGENT_SESSION_ASSISTANCE_RUNTIME_OWNER } from "../../features/session-assistance/session-assistance-session-extension.js";
import { type CodingAgentMemoryController, CodingAgentSessionMemoryController } from "../../memory/index.js";
import type { ConversationScenario } from "../../profiles/index.js";
import type { CodingAgentContextRuntime } from "../../runtime-contracts/index.js";
import type { CodingAgentConversationSessionPathAssessment } from "../contracts/conversation-persistence.js";
import type { CodingAgentRuntimeSessionOptions } from "../contracts/index.js";
import type { CodingAgentSubagentRuntime } from "../subagent/runtime.js";
import {
	type CodingAgentSubagentChildComposition,
	type CodingAgentSubagentChildCompositionRequest,
	createCodingAgentSubagentSessionAssembly,
} from "../subagent/session-assembly.js";
import { CODING_AGENT_SUBAGENT_RUNTIME_OWNER } from "../subagent/subagent-session-extension.js";
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
	readonly extensionEvents: CodingAgentExtensionRunBridge;
	readonly mcpCoordinator: CodingAgentMcpSessionCoordinator;
	readonly readSessionId: () => string;
	readonly resolveConversationPath: (sessionId: string) => string;
	readonly readConversationModelMessages: (sessionId: string) => Promise<readonly Message[]>;
	readonly createChildComposition: (
		request: CodingAgentSubagentChildCompositionRequest,
	) => Promise<CodingAgentSubagentChildComposition>;
	readonly assessChildSessionPath: (
		conversationDir: string,
		sessionId: string,
		sessionPath: string,
	) => Promise<CodingAgentConversationSessionPathAssessment>;
	readonly deferRollback: (task: InitializationRollbackTask) => void;
	readonly observationPublisher?: RuntimeObservationPublisher;
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
	peripherals.sessionExtensions.services.require(CODING_AGENT_SESSION_ASSISTANCE_RUNTIME_OWNER).attach(
		new CodingAgentSessionAssistanceRuntime({
			models: modelRuntime,
			observationPublisher: options.observationPublisher,
		}),
	);
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
		additionalAdapterFactories: [
			...(profile.additionalHookAdapterFactories ?? []),
			...(profile.createSessionHookAdapterFactories?.({
				sessionId: options.readSessionId(),
				isPluginEnabled: (pluginId) =>
					allowsAgentResource(
						peripherals.sessionExtensions.services.require(AGENT_SESSION_CONFIGURATION).readAdmitted().plugins,
						pluginId,
					),
			}) ?? []),
		],
		configLayers: profile.hookConfigLayers,
		maxStopContinuations: profile.maxStopHookContinuations,
	});
	const contextRuntime = (profile.createContextRuntime ?? createDefaultCodingAgentContextRuntime)({
		hookRuntime,
		resolveApiKey: (model) => modelRuntime.resolveApiKey(model),
		resolveSettings: profile.resolveCompactionSettings,
		generateCompaction: profile.generateCompaction,
		extensionRuntime: profile.createCompactionExtensionRuntime?.(sessionOptions),
		memoryRollover: peripherals.memoryRuntime,
		transformAgentContext: (messages) => options.extensionEvents.transformContext(messages),
		bindTransformAgentContext: (context) => {
			const bound = options.extensionEvents.bindAdapterForTurn(context);
			return {
				transform: (messages) => bound.transformContext(messages),
				release: () => bound.releaseTurnBinding(),
			};
		},
		readCompactionWorkState: () => ({
			todos: peripherals.todoRuntime.getAll().map((item) => ({ ...item })),
			backgroundTasks: peripherals.executionRuntime.backgroundService.list().map((task) => ({
				id: task.id,
				command: task.command,
				status: task.status,
				outputFile: task.outputFile,
				...(task.exitCode === undefined ? {} : { exitCode: task.exitCode }),
			})),
		}),
		observationPublisher: options.observationPublisher,
	});
	options.deferRollback({
		id: "context-runtime",
		rollback: () => contextRuntime.dispose(),
	});
	const subagentRuntime = createCodingAgentSubagentSessionAssembly({
		enabled: profile.enableSubagents === true,
		maxConcurrent: profile.subagentMaxConcurrent,
		createEntryId: profile.createSubagentId,
		pathPort: profile.subagentPathPort,
		cwd: options.sessionCwd,
		scenario: options.scenario,
		readParentSessionId: options.readSessionId,
		readParentSessionPath: () => options.resolveConversationPath(options.readSessionId()),
		readParentMessages: () => options.readConversationModelMessages(options.readSessionId()),
		readModel: () => modelRuntime.readCurrentModel(),
		readThinkingLevel: () => modelRuntime.readThinkingLevel(),
		readInheritedMcpView: async () => {
			const configuration = peripherals.sessionExtensions.services
				.require(AGENT_SESSION_CONFIGURATION)
				.readAdmitted();
			const view = await options.mcpCoordinator.readInheritedToolView(peripherals.pluginMcpRuntime);
			return {
				tools: view.tools.filter(
					({ tool, serverName }) =>
						allowsAgentResource(configuration.tools, tool.name) &&
						(configuration.mcpServers === null ||
							(serverName !== undefined && configuration.mcpServers.includes(serverName))),
				),
			};
		},
		readParentToolActivation: () => profile.activation,
		workspacePort: profile.subagentWorkspacePort,
		typeRegistry: profile.subagentTypeRegistry,
		createChildFactory: profile.createSubagentChildFactory,
		createChildComposition: options.createChildComposition,
		assessChildSessionPath: options.assessChildSessionPath,
		hookRuntime,
		resourceContext: options.resourceContext,
		observationPublisher: options.observationPublisher,
	});
	if (subagentRuntime) {
		const owner = peripherals.sessionExtensions.services.require(CODING_AGENT_SUBAGENT_RUNTIME_OWNER);
		try {
			owner.attach(subagentRuntime);
		} catch (error) {
			void subagentRuntime.dispose();
			throw error;
		}
	}
	return {
		modelRuntime,
		memoryController,
		hookRuntime,
		contextRuntime,
		subagentRuntime,
	};
}
