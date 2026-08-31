import {
	RuntimeAgentSessionAssemblyBackend,
	RuntimeOwnershipBinding,
	type RuntimeSessionCreateRequest,
} from "@vetta/runtime-core";
import { selectConversationDocumentModelMessages } from "@vetta/runtime-core/conversation";
import type { McpRuntimeToolView } from "@vetta/runtime-mcp";
import { CodingAgentRuntimeModelAdapter } from "../adapters/runtime-core/model-runtime-adapter.js";
import { CodingAgentExtensionToolRuntime } from "../extensions/runtime/extension-tool-runtime.js";
import { DEFAULT_SCENARIO } from "../profiles/index.js";
import { CodingAgentConversationContextOverlay } from "../sessions/projection/conversation-context-overlay.js";
import { CodingAgentConversationContextProjector } from "../sessions/projection/conversation-context-projector.js";
import type {
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeCompositionOptions,
	CodingAgentRuntimeSessionOptions,
} from "./contracts/index.js";
import { requireCodingAgentRuntimeSessionOptions } from "./contracts/index.js";

export {
	CODING_AGENT_BUILTIN_SOURCE,
	publishCodingAgentExecutionRuntimeDefinition,
} from "./agent-runtime/composition-agent-runtime.js";
export {
	type CodingAgentExecutionRuntimeDefinitionOptions,
	createCodingAgentExecutionRuntimeDefinition,
} from "./agent-runtime/execution-definition.js";
export { parseCodingAgentRuntimeSessionConfiguration } from "./contracts/index.js";
export {
	type CodingAgentRuntimeHostSessionOverrides,
	createCodingAgentRuntimeHostSessionConfig,
	createCodingAgentRuntimeSessionAgentSelection,
	createCodingAgentRuntimeSessionSelection,
	createIsolatedCodingAgentRuntimeHostSession,
	type IsolatedCodingAgentRuntimeHostSessionOptions,
} from "./runtime-host-session-config.js";

import {
	type CodingAgentCompositionAgentRuntimeScope,
	createCodingAgentCompositionAgentRuntimeScope,
} from "./agent-runtime/composition-agent-runtime.js";
import { createCodingAgentChildCompositionFactory } from "./subagent/child-composition-policy.js";

export type { CodingAgentRuntimeToolRegistration } from "../runtime-contracts/index.js";
export type {
	CodingAgentInitialTodoLockSource,
	CodingAgentObservationHubOptions,
	CodingAgentObservationRoute,
	CodingAgentPromptRuntimeSourceContext,
	CodingAgentPromptRuntimeSources,
	CodingAgentRuntimeAgentIdentity,
	CodingAgentRuntimeAgentOptions,
	CodingAgentRuntimeAgentReference,
	CodingAgentRuntimeComposition,
	CodingAgentRuntimeCompositionOptions,
	CodingAgentRuntimeExtensionControls,
	CodingAgentRuntimeHostRetrySettings,
	CodingAgentRuntimeSessionConfiguration,
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
import { mapCodingAgentRuntimeSessionCreationError, withCodingAgentRuntimeHostRetry } from "./runtime-host-retry.js";
import { createCodingAgentSessionInitializationProfile } from "./session-initialization/profile.js";
import { createCodingAgentSessionInitializationTransaction } from "./session-initialization/transaction.js";
import { createCodingAgentCompositionShutdown } from "./session-lifecycle/composition-shutdown.js";
import { createCodingAgentRuntimeExtensionControls } from "./session-lifecycle/extension-controls.js";
import { CodingAgentCompositionResourceRegistry } from "./session-lifecycle/resource-registry.js";
import { createCodingAgentRuntimeSessionControls } from "./session-lifecycle/session-controls.js";
import { createCodingAgentRuntimeToolSurface } from "./tool-surface/runtime-tool-surface.js";
import { CodingAgentImageSettingsSnapshotRouter } from "./turn/image-settings-snapshot-router.js";

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
	let agentRuntimeScope: CodingAgentCompositionAgentRuntimeScope | undefined;
	try {
		agentRuntimeScope = createCodingAgentCompositionAgentRuntimeScope({
			configuration: options.agentRuntime,
			observationPublisher: observationRuntime.publisher,
		});
		return await assembleCodingAgentRuntimeComposition(
			options,
			inheritedMcpView,
			observationRuntime,
			agentRuntimeScope,
		);
	} catch (error) {
		const cleanupResults = await Promise.allSettled([agentRuntimeScope?.close(), observationRuntime.hub.close()]);
		const cleanupErrors = cleanupResults.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
		if (cleanupErrors.length > 0) {
			throw new AggregateError([error, ...cleanupErrors], "Coding Agent Composition assembly and rollback failed");
		}
		throw error;
	}
}

async function assembleCodingAgentRuntimeComposition(
	options: CodingAgentRuntimeCompositionOptions,
	inheritedMcpView: McpRuntimeToolView,
	observationRuntime: CodingAgentObservationRuntime,
	agentRuntimeScope: CodingAgentCompositionAgentRuntimeScope,
): Promise<CodingAgentRuntimeComposition> {
	const observationPublisher = observationRuntime.publisher;
	const cwd = options.cwd ?? ".";
	const scenario = options.scenario ?? "cli";
	const sessionInitializationProfile = createCodingAgentSessionInitializationProfile(options);
	const extensionToolRuntime = new CodingAgentExtensionToolRuntime(options.extensionTools ?? []);
	const resourceRegistry = new CodingAgentCompositionResourceRegistry();
	const imageSettingsSnapshots = new CodingAgentImageSettingsSnapshotRouter(observationPublisher);
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
		configurationSource: imageSettingsSnapshots,
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
		return RuntimeOwnershipBinding.acquire(manager, sessionPath);
	};
	const releaseOwnership = async (binding: RuntimeOwnershipBinding<string> | undefined): Promise<void> => {
		if (!binding) return;
		await binding.dispose();
	};
	const conversation = {
		repository,
		documentStore: persistence.documentStore,
		continuationStore: persistence.continuationStore,
		resolveConversationPath: persistence.resolveConversationPath,
		resolveSessionDirectory: persistence.resolveSessionDirectory,
		resolveSessionPath: persistence.resolveSessionPath,
	};
	const {
		observationPublisher: _observationPublisher,
		agentRuntime: _agentRuntime,
		...optionsWithoutPublisher
	} = options;
	const createChildComposition = createCodingAgentChildCompositionFactory({
		parentOptions: {
			...optionsWithoutPublisher,
			agentRuntime: agentRuntimeScope.childConfiguration(),
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
		imageSettingsSnapshots,
	});
	const agentSelection = agentRuntimeScope.createSelection((agentSessionContext, request) =>
		sessionInitialization.prepare(request.options, request.resourceContext, agentSessionContext),
	);
	const runtimeAgentBackend = new RuntimeAgentSessionAssemblyBackend({
		runtime: agentRuntimeScope.runtime,
		observationPublisher,
		identity: {
			resolve: (request) => ({ sessionId: readCodingAgentSessionOptions(request).sessionId }),
		},
		sessionConfiguration: {
			resolve: ({ request, resourceContext }) => ({
				options: readCodingAgentSessionOptions(request),
				resourceContext,
			}),
		},
		engine: {
			streamFn: options.streamFn,
			tracer: options.tracer,
			tracing: options.tracing,
		},
		decorateAssembly: options.runtimeHostRetrySettings
			? ({ session, assembly }) =>
					withCodingAgentRuntimeHostRetry(
						session,
						assembly,
						options.runtimeHostRetrySettings!,
						observationPublisher,
					)
			: undefined,
		mapCreationError: mapCodingAgentRuntimeSessionCreationError,
	});
	const runtimeHostBackend = {
		createAssembly: (request: RuntimeSessionCreateRequest) => {
			if (request.agent && request.agent.id !== agentRuntimeScope.agentId) {
				throw new Error(
					`Coding Agent Composition cannot execute Agent ${request.agent.id}; expected ${agentRuntimeScope.agentId}`,
				);
			}
			const sessionOptions = readCodingAgentSessionOptions(request);
			if ((sessionOptions.scenario ?? DEFAULT_SCENARIO) !== scenario) {
				throw new Error(
					`Coding Agent Composition scenario mismatch: expected ${scenario}, received ${sessionOptions.scenario ?? DEFAULT_SCENARIO}`,
				);
			}
			return runtimeAgentBackend.createAssembly({
				...request,
				agent: {
					...agentSelection,
					definitionRevisionId: request.agent?.definitionRevisionId,
					sessionConfiguration: request.agent?.sessionConfiguration,
				},
			});
		},
	};
	const compositionShutdown = createCodingAgentCompositionShutdown({
		registry: resourceRegistry,
		clearConversationContextOverlay: () => conversationContextOverlay.clearAll(),
		closeConversationRepository: () => persistence.dispose(),
		disposeMcpSynchronizer: mcpCoordinator.sharedRuntimeAvailable ? () => mcpCoordinator.dispose() : undefined,
		disposeCodingTools: () => tools.dispose(),
		closeAgentRuntime: async () => {
			await runtimeAgentBackend.dispose();
			await agentRuntimeScope.close();
		},
		closeObservationHub: () => observationRuntime.hub.close(),
	});
	const sessionControls = createCodingAgentRuntimeSessionControls({
		indexes: resourceRegistry.indexes,
		readAgentIdentity: (sessionId) => agentRuntimeScope.runtime.getSession(sessionId),
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
		runtimeHostBackend,
		tools,
		agentRuntime: {
			agentId: agentRuntimeScope.agentId,
		},
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

function readCodingAgentSessionOptions(request: RuntimeSessionCreateRequest): CodingAgentRuntimeSessionOptions {
	const options = requireCodingAgentRuntimeSessionOptions(request.agent?.sessionConfiguration);
	if (request.sessionId !== undefined && request.sessionId !== options.sessionId) {
		throw new Error(
			`Coding Agent Runtime Session identity mismatch: expected ${options.sessionId}, received ${request.sessionId}`,
		);
	}
	return {
		...options,
		cwd: request.cwd ?? options.cwd,
		model: request.model ?? options.model,
		thinkingLevel: request.thinkingLevel ?? options.thinkingLevel,
		executionMode: request.executionMode,
		env: request.env ?? options.env,
		sandboxHostPath: request.sandboxHostPath ?? options.sandboxHostPath,
		linuxBubblewrapPath: request.linuxBubblewrapPath ?? options.linuxBubblewrapPath,
		macosSandboxExecPath: request.macosSandboxExecPath ?? options.macosSandboxExecPath,
	};
}
