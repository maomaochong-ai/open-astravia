import { ComposedGreenfieldRuntimeFactory, GreenfieldRuntimeSessionBackend } from "@vetta/runtime-core";
import { selectConversationDocumentModelMessages } from "@vetta/runtime-core/conversation";
import type { McpRuntimeToolView } from "@vetta/runtime-mcp";
import { CodingAgentGreenfieldExtensionToolRuntime } from "../adapters/runtime-core/greenfield-extension-tool-runtime.js";
import { CodingAgentRuntimeModelAdapter } from "../adapters/runtime-core/model-runtime-adapter.js";
import { CodingAgentConversationContextOverlay } from "../sessions/projection/conversation-context-overlay.js";
import { CodingAgentConversationContextProjector } from "../sessions/projection/conversation-context-projector.js";
import type {
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeCompositionOptions,
	CodingAgentRuntimeSessionOptions,
} from "./contracts/index.js";
import { resolveCodingAgentConversationPersistence } from "./conversation/persistence.js";
import { ConversationOwnershipBinding } from "./conversation-ownership-binding.js";
import { createCodingAgentChildCompositionFactory } from "./subagent/child-composition-policy.js";

export type {
	CodingAgentInitialTodoLockSource,
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeCompositionOptions,
	CodingAgentRuntimeExtensionControls,
	CodingAgentRuntimeSessionControls,
	CodingAgentRuntimeSessionHookLifecycle,
	CodingAgentRuntimeSessionOptions,
	CodingAgentRuntimeToolAccess,
} from "./contracts/index.js";

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
 * 它使用真实文件 Repository 与 Runtime Coding Tools；宿主必须显式持有并使用返回的 Backend。
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
	const cwd = options.cwd ?? process.cwd();
	const scenario = options.scenario ?? "cli";
	const sessionInitializationProfile = createCodingAgentSessionInitializationProfile(options);
	const extensionToolRuntime = new CodingAgentGreenfieldExtensionToolRuntime(options.extensionTools ?? []);
	const resourceRegistry = new CodingAgentCompositionResourceRegistry();
	const toolSurface = await createCodingAgentRuntimeToolSurface({
		cwd,
		scenario,
		activation: options.activation,
		knowledgeEnabled: options.knowledgeEnabled,
		knowledgeRoot: options.knowledgeRoot,
		inheritedMcpView,
		mcpSource: options.mcpSource,
		indexes: resourceRegistry.indexes,
		tokenBudget: options.tokenBudget,
		reservedOutputTokens: options.reservedOutputTokens,
	});
	const {
		activation: effectiveActivation,
		backgroundTasksAvailable,
		knowledgeAvailable,
		mcpCoordinator,
		tools,
	} = toolSurface;
	const persistence = await resolveCodingAgentConversationPersistence(options);
	const repository = persistence.repository;
	const baseConversationContextProjector = new CodingAgentConversationContextProjector();
	const conversationContextOverlay = new CodingAgentConversationContextOverlay(baseConversationContextProjector);
	const modelAdapter = new CodingAgentRuntimeModelAdapter(options.modelRegistry);
	const acquireOwnership = async (sessionId: string): Promise<ConversationOwnershipBinding | undefined> => {
		const manager = options.conversationOwnershipManager;
		if (!manager) return undefined;
		const sessionPath = persistence.resolveSessionPath(sessionId);
		if (!sessionPath) throw new Error("Conversation ownership requires a persistent session path");
		const binding = await ConversationOwnershipBinding.acquire(manager, sessionPath);
		resourceRegistry.trackOwnershipBinding(binding);
		return binding;
	};
	const releaseOwnership = async (binding: ConversationOwnershipBinding | undefined): Promise<void> => {
		if (!binding) return;
		await binding.dispose();
		resourceRegistry.untrackOwnershipBinding(binding);
	};
	const conversation = {
		repository,
		documentStore: persistence.documentStore,
		continuationStore: persistence.continuationStore,
		resolveConversationPath: persistence.resolveConversationPath,
		resolveSessionPath: persistence.resolveSessionPath,
	};
	const createChildComposition = createCodingAgentChildCompositionFactory({
		parentOptions: options,
		createComposition: createCodingAgentRuntimeCompositionInternal,
	});
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
	});
	const runtimeFactory = new ComposedGreenfieldRuntimeFactory<CodingAgentRuntimeSessionOptions>({
		streamFn: options.streamFn,
		tracer: options.tracer,
		tracing: options.tracing,
		createResources: (sessionOptions, resourceContext) =>
			sessionInitialization.initialize(sessionOptions, resourceContext),
	});
	const backend = new GreenfieldRuntimeSessionBackend({ runtimeFactory });
	const compositionShutdown = createCodingAgentCompositionShutdown({
		registry: resourceRegistry,
		clearConversationContextOverlay: () => conversationContextOverlay.clearAll(),
		closeConversationRepository: () => persistence.dispose(),
		disposeMcpSynchronizer: mcpCoordinator.sharedRuntimeAvailable ? () => mcpCoordinator.dispose() : undefined,
		disposeCodingTools: () => tools.dispose(),
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
		scenario,
		...sessionControls,
		...extensionControls,
		async dispose() {
			await compositionShutdown.dispose();
		},
	};
}

const EMPTY_MCP_TOOL_VIEW: McpRuntimeToolView = Object.freeze({ tools: Object.freeze([]) });
