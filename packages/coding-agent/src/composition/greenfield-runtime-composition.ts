import { ComposedGreenfieldRuntimeFactory, GreenfieldRuntimeSessionBackend } from "@vetta/runtime-core";
import { selectConversationDocumentModelMessages } from "@vetta/runtime-core/conversation";
import type { McpRuntimeToolView } from "@vetta/runtime-mcp";
import { CodingAgentGreenfieldAgentMessageContextProjector } from "../adapters/runtime-core/greenfield-agent-message-context-projector.js";
import { CodingAgentGreenfieldConversationContextOverlay } from "../adapters/runtime-core/greenfield-conversation-context-overlay.js";
import { CodingAgentGreenfieldExtensionToolRuntime } from "../adapters/runtime-core/greenfield-extension-tool-runtime.js";
import { CodingAgentRuntimeModelAdapter } from "../adapters/runtime-core/greenfield-model-runtime-adapter.js";
import { ConversationOwnershipBinding } from "./conversation-ownership-binding.js";
import { createGreenfieldChildCompositionFactory } from "./greenfield-child-composition-policy.js";
import { GreenfieldCompositionResourceRegistry } from "./greenfield-composition-resource-registry.js";
import { createGreenfieldCompositionShutdown } from "./greenfield-composition-shutdown.js";
import { resolveGreenfieldConversationPersistence } from "./greenfield-conversation-persistence.js";
import type {
	GreenfieldRuntimeComposition,
	GreenfieldRuntimeCompositionOptions,
	GreenfieldRuntimeSessionOptions,
} from "./greenfield-runtime-composition-contract.js";

export type {
	GreenfieldInitialTodoLockSource,
	GreenfieldRuntimeComposition,
	GreenfieldRuntimeCompositionOptions,
	GreenfieldRuntimeExtensionControls,
	GreenfieldRuntimeSessionControls,
	GreenfieldRuntimeSessionHookLifecycle,
	GreenfieldRuntimeSessionOptions,
	GreenfieldRuntimeToolAccess,
} from "./greenfield-runtime-composition-contract.js";

import { createGreenfieldRuntimeExtensionControls } from "./greenfield-runtime-extension-controls.js";
import { createGreenfieldRuntimeSessionControls } from "./greenfield-runtime-session-controls.js";
import { createGreenfieldRuntimeToolSurface } from "./greenfield-runtime-tool-surface.js";
import { createGreenfieldSessionInitializationProfile } from "./greenfield-session-initialization-profile.js";
import { createGreenfieldSessionInitializationTransaction } from "./greenfield-session-initialization-transaction.js";

/**
 * Greenfield Runtime 的共享组合入口。
 *
 * 它使用真实文件 Repository 与 Runtime Coding Tools；宿主必须显式持有并使用返回的 Backend。
 */
export async function createGreenfieldRuntimeComposition(
	options: GreenfieldRuntimeCompositionOptions,
): Promise<GreenfieldRuntimeComposition> {
	return createGreenfieldRuntimeCompositionInternal(options, EMPTY_MCP_TOOL_VIEW);
}

async function createGreenfieldRuntimeCompositionInternal(
	options: GreenfieldRuntimeCompositionOptions,
	inheritedMcpView: McpRuntimeToolView,
): Promise<GreenfieldRuntimeComposition> {
	const cwd = options.cwd ?? process.cwd();
	const scenario = options.scenario ?? "cli";
	const sessionInitializationProfile = createGreenfieldSessionInitializationProfile(options);
	const extensionToolRuntime = new CodingAgentGreenfieldExtensionToolRuntime(options.extensionTools ?? []);
	const resourceRegistry = new GreenfieldCompositionResourceRegistry();
	const toolSurface = await createGreenfieldRuntimeToolSurface({
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
	const persistence = await resolveGreenfieldConversationPersistence(options);
	const repository = persistence.repository;
	const baseConversationContextProjector = new CodingAgentGreenfieldAgentMessageContextProjector();
	const conversationContextOverlay = new CodingAgentGreenfieldConversationContextOverlay(
		baseConversationContextProjector,
	);
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
	const createChildComposition = createGreenfieldChildCompositionFactory({
		parentOptions: options,
		createComposition: createGreenfieldRuntimeCompositionInternal,
	});
	const sessionInitialization = createGreenfieldSessionInitializationTransaction({
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
	const runtimeFactory = new ComposedGreenfieldRuntimeFactory<GreenfieldRuntimeSessionOptions>({
		streamFn: options.streamFn,
		tracer: options.tracer,
		tracing: options.tracing,
		createResources: (sessionOptions, resourceContext) =>
			sessionInitialization.initialize(sessionOptions, resourceContext),
	});
	const backend = new GreenfieldRuntimeSessionBackend({ runtimeFactory });
	const compositionShutdown = createGreenfieldCompositionShutdown({
		registry: resourceRegistry,
		clearConversationContextOverlay: () => conversationContextOverlay.clearAll(),
		closeConversationRepository: () => persistence.dispose(),
		disposeMcpSynchronizer: mcpCoordinator.sharedRuntimeAvailable ? () => mcpCoordinator.dispose() : undefined,
		disposeCodingTools: () => tools.dispose(),
	});
	const sessionControls = createGreenfieldRuntimeSessionControls({
		indexes: resourceRegistry.indexes,
		readConversationDocument: (sessionId) => persistence.documentStore.readDocument(sessionId),
		projectConversationContext: (document) => conversationContextOverlay.project(document),
		projectConversationSeed: (document) => baseConversationContextProjector.project(document),
		preserveConversationContext: (targetSessionId, source, targetSeed) =>
			conversationContextOverlay.preserve(targetSessionId, source, targetSeed),
		clearConversationContext: (sessionId) => conversationContextOverlay.clear(sessionId),
		reloadMcp: (sessionId) => mcpCoordinator.refreshSession(sessionId, false),
	});
	const extensionControls = createGreenfieldRuntimeExtensionControls({
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
