import { ComposedRuntimeFactory, KernelRuntimeSessionBackend, RuntimeOwnershipBinding } from "@vetta/runtime-core";
import { selectConversationDocumentModelMessages } from "@vetta/runtime-core/conversation";
import type { McpRuntimeToolView } from "@vetta/runtime-mcp";
import { CodingAgentRuntimeModelAdapter } from "../adapters/runtime-core/model-runtime-adapter.js";
import { CodingAgentExtensionToolRuntime } from "../extensions/runtime/extension-tool-runtime.js";
import { CodingAgentConversationContextOverlay } from "../sessions/projection/conversation-context-overlay.js";
import { CodingAgentConversationContextProjector } from "../sessions/projection/conversation-context-projector.js";
import type {
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeCompositionOptions,
	CodingAgentRuntimeSessionOptions,
} from "./contracts/index.js";
import { createCodingAgentChildCompositionFactory } from "./subagent/child-composition-policy.js";

export type {
	CodingAgentInitialTodoLockSource,
	CodingAgentObservationHubOptions,
	CodingAgentObservationRoute,
	CodingAgentPromptRuntimeSourceContext,
	CodingAgentPromptRuntimeSources,
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeCompositionOptions,
	CodingAgentRuntimeExtensionControls,
	CodingAgentRuntimeSessionControls,
	CodingAgentRuntimeSessionHookLifecycle,
	CodingAgentRuntimeSessionOptions,
	CodingAgentRuntimeToolAccess,
} from "./contracts/index.js";

import {
	type CodingAgentObservationRuntime,
	createChildCodingAgentObservationOptions,
	createCodingAgentObservationRuntime,
} from "./observability/observation-runtime.js";
import { createCodingAgentSessionInitializationProfile } from "./session-initialization/profile.js";
import { createCodingAgentSessionInitializationTransaction } from "./session-initialization/transaction.js";
import { createCodingAgentCompositionShutdown } from "./session-lifecycle/composition-shutdown.js";
import { createCodingAgentRuntimeExtensionControls } from "./session-lifecycle/extension-controls.js";
import { CodingAgentCompositionResourceRegistry } from "./session-lifecycle/resource-registry.js";
import { createCodingAgentRuntimeSessionControls } from "./session-lifecycle/session-controls.js";
import { createCodingAgentRuntimeToolSurface } from "./tool-surface/runtime-tool-surface.js";

/**
 * Coding Agent Runtime 的共享组合入口。
 *
 * 它组合 Coding Agent 产品能力；平台持久化必须由宿主显式注入。
 */
export async function createCodingAgentRuntimeComposition(
	options: CodingAgentRuntimeCompositionOptions,
): Promise<CodingAgentRuntimeComposition> {
	return createCodingAgentRuntimeCompositionInternal(options, EMPTY_MCP_TOOL_VIEW);
}

async function createCodingAgentRuntimeCompositionInternal(
	options: CodingAgentRuntimeCompositionOptions,
	inheritedMcpView: McpRuntimeToolView,
): Promise<CodingAgentRuntimeComposition> {
	const observationRuntime = createCodingAgentObservationRuntime({
		publisher: options.observationPublisher,
		hub: options.observationHub,
	});
	try {
		return await assembleCodingAgentRuntimeComposition(options, inheritedMcpView, observationRuntime);
	} catch (error) {
		await observationRuntime.hub.close();
		throw error;
	}
}

async function assembleCodingAgentRuntimeComposition(
	options: CodingAgentRuntimeCompositionOptions,
	inheritedMcpView: McpRuntimeToolView,
	observationRuntime: CodingAgentObservationRuntime,
): Promise<CodingAgentRuntimeComposition> {
	const observationPublisher = observationRuntime.publisher;
	const cwd = options.cwd ?? ".";
	const scenario = options.scenario ?? "cli";
	const sessionInitializationProfile = createCodingAgentSessionInitializationProfile(options);
	const extensionToolRuntime = new CodingAgentExtensionToolRuntime(options.extensionTools ?? []);
	const resourceRegistry = new CodingAgentCompositionResourceRegistry();
	const toolSurface = await createCodingAgentRuntimeToolSurface({
		cwd,
		agentDir: options.agentDir,
		scenario,
		activation: options.activation,
		knowledgeRuntime: options.knowledgeRuntime,
		inheritedMcpView,
		mcpSource: options.mcpSource,
		indexes: resourceRegistry.indexes,
		tokenBudget: options.tokenBudget,
		reservedOutputTokens: options.reservedOutputTokens,
		createToolEnvironment: options.createToolEnvironment,
		resultPolicy: options.codingToolResultPolicy,
		observationPublisher,
	});
	const {
		activation: effectiveActivation,
		backgroundTasksAvailable,
		knowledgeAvailable,
		mcpCoordinator,
		tools,
	} = toolSurface;
	const persistence = await options.createConversationPersistence({
		conversationDir: options.conversationDir,
	});
	const repository = persistence.repository;
	const baseConversationContextProjector = new CodingAgentConversationContextProjector();
	const conversationContextOverlay = new CodingAgentConversationContextOverlay(baseConversationContextProjector);
	const modelAdapter = new CodingAgentRuntimeModelAdapter(options.modelRegistry);
	const acquireOwnership = async (sessionId: string): Promise<RuntimeOwnershipBinding<string> | undefined> => {
		const manager = options.conversationOwnershipManager;
		if (!manager) return undefined;
		const sessionPath = persistence.resolveSessionPath(sessionId);
		if (!sessionPath) throw new Error("Conversation ownership requires a persistent session path");
		const binding = await RuntimeOwnershipBinding.acquire(manager, sessionPath);
		resourceRegistry.trackOwnershipBinding(binding);
		return binding;
	};
	const releaseOwnership = async (binding: RuntimeOwnershipBinding<string> | undefined): Promise<void> => {
		if (!binding) return;
		await binding.dispose();
		resourceRegistry.untrackOwnershipBinding(binding);
	};
	const conversation = {
		repository,
		documentStore: persistence.documentStore,
		continuationStore: persistence.continuationStore,
		resolveConversationPath: persistence.resolveConversationPath,
		resolveSessionDirectory: persistence.resolveSessionDirectory,
		resolveSessionPath: persistence.resolveSessionPath,
	};
	const { observationPublisher: _observationPublisher, ...optionsWithoutPublisher } = options;
	const createChildComposition = createCodingAgentChildCompositionFactory({
		parentOptions: {
			...optionsWithoutPublisher,
			observationHub: createChildCodingAgentObservationOptions(options.observationHub, observationRuntime.hub),
		},
		createComposition: createCodingAgentRuntimeCompositionInternal,
	});
	const assessChildSessionPath = async (conversationDir: string, sessionId: string, sessionPath: string) => {
		const childPersistence = await options.createConversationPersistence({ conversationDir });
		try {
			return await childPersistence.assessSessionPath(sessionId, sessionPath);
		} finally {
			await childPersistence.dispose();
		}
	};
	const sessionInitialization = createCodingAgentSessionInitializationTransaction({
		profile: sessionInitializationProfile,
		cwd,
		scenario,
		activation: effectiveActivation,
		knowledgeAvailable,
		backgroundTasksAvailable,
		codingTools: tools,
		registry: resourceRegistry,
		mcpCoordinator,
		conversation,
		readConversationModelMessages: async (sessionId) =>
			selectConversationDocumentModelMessages(await persistence.documentStore.readDocument(sessionId)),
		conversationContextOverlay,
		modelAdapter,
		extensionToolRuntime,
		acquireOwnership,
		rebindOwnership: async (binding, sessionId) => {
			if (!binding) return;
			const sessionPath = persistence.resolveSessionPath(sessionId);
			if (!sessionPath) throw new Error("Conversation ownership requires a persistent session path");
			await binding.rebind(sessionPath);
		},
		releaseOwnership,
		resolveActivation: toolSurface.resolveActivation,
		createChildComposition,
		assessChildSessionPath,
		observationPublisher,
	});
	const runtimeFactory = new ComposedRuntimeFactory<CodingAgentRuntimeSessionOptions>({
		streamFn: options.streamFn,
		tracer: options.tracer,
		tracing: options.tracing,
		observationPublisher,
		createResources: (sessionOptions, resourceContext) =>
			sessionInitialization.initialize(sessionOptions, resourceContext),
	});
	const backend = new KernelRuntimeSessionBackend({ runtimeFactory });
	const compositionShutdown = createCodingAgentCompositionShutdown({
		registry: resourceRegistry,
		clearConversationContextOverlay: () => conversationContextOverlay.clearAll(),
		closeConversationRepository: () => persistence.dispose(),
		disposeMcpSynchronizer: mcpCoordinator.sharedRuntimeAvailable ? () => mcpCoordinator.dispose() : undefined,
		disposeCodingTools: () => tools.dispose(),
		closeObservationHub: () => observationRuntime.hub.close(),
	});
	const sessionControls = createCodingAgentRuntimeSessionControls({
		indexes: resourceRegistry.indexes,
		readConversationDocument: (sessionId) => persistence.documentStore.readDocument(sessionId),
		projectConversationContext: (document) => conversationContextOverlay.project(document),
		projectConversationSeed: (document) => baseConversationContextProjector.project(document),
		preserveConversationContext: (targetSessionId, source, targetSeed) =>
			conversationContextOverlay.preserve(targetSessionId, source, targetSeed),
		clearConversationContext: (sessionId) => conversationContextOverlay.clear(sessionId),
		reloadMcp: (sessionId) => mcpCoordinator.refreshSession(sessionId, false),
	});
	const extensionControls = createCodingAgentRuntimeExtensionControls({
		indexes: resourceRegistry.indexes,
		extensionToolRuntime,
	});
	return {
		backend,
		tools,
		observations: observationRuntime.hub,
		scenario,
		...sessionControls,
		...extensionControls,
		async dispose() {
			await compositionShutdown.dispose();
		},
	};
}

const EMPTY_MCP_TOOL_VIEW: McpRuntimeToolView = Object.freeze({ tools: Object.freeze([]) });
