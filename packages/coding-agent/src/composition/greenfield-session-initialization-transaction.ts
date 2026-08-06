import type { Message } from "@vetta/ai";
import {
	type ConversationScenario,
	type GreenfieldRuntimeResourceContext,
	type GreenfieldRuntimeResources,
	InitializationRollbackScope,
} from "@vetta/runtime-core";
import type { ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import type { CodingToolActivation } from "@vetta/runtime-tools/coding";
import {
	type CodingAgentContextRuntime,
	CodingAgentGreenfieldExtensionEventBridge,
	type CodingAgentMemoryRolloverRuntime,
	type CodingAgentRuntimeModelAdapter,
} from "../adapters/runtime-core/greenfield.js";
import type { CodingAgentGreenfieldConversationContextOverlay } from "../adapters/runtime-core/greenfield-conversation-context-overlay.js";
import type { CodingAgentGreenfieldExtensionToolRuntime } from "../adapters/runtime-core/greenfield-extension-tool-runtime.js";
import type { CodingAgentTodoRuntime } from "../runtime-contracts/index.js";
import type { GreenfieldMcpSessionCoordinator } from "./greenfield-mcp-session-coordinator.js";
import type { GreenfieldRuntimeSessionOptions } from "./greenfield-runtime-composition-contract.js";
import { createGreenfieldSessionContextAssembly } from "./greenfield-session-context-assembly.js";
import type { GreenfieldSessionInitializationProfile } from "./greenfield-session-initialization-profile.js";
import { createGreenfieldSessionPeripheralAssembly } from "./greenfield-session-peripheral-assembly.js";
import type { GreenfieldSessionResourceIndexes } from "./greenfield-session-resource-lifecycle-assembly.js";
import { createGreenfieldSessionResourceLifecycleAssembly } from "./greenfield-session-resource-lifecycle-assembly.js";
import type { GreenfieldSessionConversationResources } from "./greenfield-session-runtime-resources.js";
import type {
	GreenfieldSubagentChildComposition,
	GreenfieldSubagentChildCompositionRequest,
} from "./greenfield-subagent-session-assembly.js";
import {
	createGreenfieldTurnCapabilitySessionAssembly,
	type GreenfieldTurnCapabilitySessionAssembly,
} from "./greenfield-turn-capability-session-assembly.js";
import type { CodingToolsRuntimeComposition } from "./runtime-tools-composition.js";

export interface GreenfieldSessionInitializationRegistry {
	readonly indexes: GreenfieldSessionResourceIndexes;
	trackContextRuntime(runtime: CodingAgentContextRuntime): void;
	untrackContextRuntime(runtime: CodingAgentContextRuntime): void;
	trackMemoryRuntime(runtime: CodingAgentMemoryRolloverRuntime): void;
	untrackMemoryRuntime(runtime: CodingAgentMemoryRolloverRuntime): void;
	trackTodoRuntime(runtime: CodingAgentTodoRuntime): void;
	untrackTodoRuntime(runtime: CodingAgentTodoRuntime): void;
	trackTurnCapabilityAssembly(assembly: GreenfieldTurnCapabilitySessionAssembly): void;
	untrackTurnCapabilityAssembly(assembly: GreenfieldTurnCapabilitySessionAssembly): void;
	trackHookSessionDisposer(dispose: () => Promise<void>): void;
	untrackHookSessionDisposer(dispose: () => Promise<void>): void;
}

export interface GreenfieldSessionInitializationTransactionOptions<TOwnershipBinding> {
	readonly profile: GreenfieldSessionInitializationProfile;
	readonly cwd: string;
	readonly scenario: ConversationScenario;
	readonly activation: CodingToolActivation;
	readonly knowledgeAvailable: boolean;
	readonly backgroundTasksAvailable: boolean;
	readonly codingTools: CodingToolsRuntimeComposition;
	readonly registry: GreenfieldSessionInitializationRegistry;
	readonly mcpCoordinator: GreenfieldMcpSessionCoordinator;
	readonly conversation: GreenfieldSessionConversationResources;
	readonly readConversationModelMessages: (sessionId: string) => Promise<readonly Message[]>;
	readonly conversationContextOverlay: CodingAgentGreenfieldConversationContextOverlay;
	readonly modelAdapter: CodingAgentRuntimeModelAdapter;
	readonly extensionToolRuntime?: CodingAgentGreenfieldExtensionToolRuntime;
	readonly acquireOwnership: (sessionId: string) => Promise<TOwnershipBinding | undefined>;
	readonly rebindOwnership: (binding: TOwnershipBinding | undefined, sessionId: string) => Promise<void>;
	readonly releaseOwnership: (binding: TOwnershipBinding | undefined) => Promise<void>;
	readonly resolveActivation: (
		context: ModelCallContributionContext,
		agentMode?: string,
		activeToolNamesOverride?: readonly string[],
	) => CodingToolActivation;
	readonly createChildComposition: (
		request: GreenfieldSubagentChildCompositionRequest,
	) => Promise<GreenfieldSubagentChildComposition>;
}

export interface GreenfieldSessionInitializationTransaction {
	initialize(
		sessionOptions: GreenfieldRuntimeSessionOptions,
		resourceContext: GreenfieldRuntimeResourceContext,
	): Promise<GreenfieldRuntimeResources>;
}

/** 创建单个 Session 的完整对象图，并在提交前统一持有初始化失败回滚责任。 */
export function createGreenfieldSessionInitializationTransaction<TOwnershipBinding>(
	options: GreenfieldSessionInitializationTransactionOptions<TOwnershipBinding>,
): GreenfieldSessionInitializationTransaction {
	return {
		initialize: (sessionOptions, resourceContext) => initializeSession(options, sessionOptions, resourceContext),
	};
}

async function initializeSession<TOwnershipBinding>(
	options: GreenfieldSessionInitializationTransactionOptions<TOwnershipBinding>,
	sessionOptions: GreenfieldRuntimeSessionOptions,
	resourceContext: GreenfieldRuntimeResourceContext,
): Promise<GreenfieldRuntimeResources> {
	const profile = options.profile;
	let activeSessionId = sessionOptions.sessionId;
	let activeOwnership = await options.acquireOwnership(activeSessionId);
	const rollback = new InitializationRollbackScope();
	rollback.defer({
		id: "conversation-ownership",
		rollback: async () => {
			await options.releaseOwnership(activeOwnership);
			activeOwnership = undefined;
		},
	});
	const extensionEvents = new CodingAgentGreenfieldExtensionEventBridge();
	options.registry.indexes.resourceContexts.set(activeSessionId, resourceContext);
	rollback.defer({
		id: "resource-context-binding",
		rollback: () => {
			if (options.registry.indexes.resourceContexts.get(activeSessionId) === resourceContext) {
				options.registry.indexes.resourceContexts.delete(activeSessionId);
			}
		},
	});
	rollback.defer({
		id: "conversation-context-overlay",
		rollback: () => options.conversationContextOverlay.clear(activeSessionId),
	});
	try {
		if (sessionOptions.sessionTools) {
			options.extensionToolRuntime?.replaceSessionTools(activeSessionId, sessionOptions.sessionTools);
			rollback.defer({
				id: "session-tool-overlay",
				rollback: () => options.extensionToolRuntime?.clearSessionTools(activeSessionId),
			});
		}
		const sessionCwd = sessionOptions.cwd ?? options.cwd;
		const peripherals = await createGreenfieldSessionPeripheralAssembly({
			profile,
			sessionOptions,
			sessionCwd,
			scenario: options.scenario,
			activation: options.activation,
			codingTools: options.codingTools,
			indexes: options.registry.indexes,
			mcpCoordinator: options.mcpCoordinator,
			resourceContext,
			readSessionId: () => activeSessionId,
			resolveActivation: options.resolveActivation,
			trackMemoryRuntime: (runtime) => options.registry.trackMemoryRuntime(runtime),
			untrackMemoryRuntime: (runtime) => options.registry.untrackMemoryRuntime(runtime),
			trackTodoRuntime: (runtime) => options.registry.trackTodoRuntime(runtime),
			untrackTodoRuntime: (runtime) => options.registry.untrackTodoRuntime(runtime),
			deferRollback: (task) => {
				rollback.defer(task);
			},
		});
		const context = createGreenfieldSessionContextAssembly({
			profile,
			sessionOptions,
			sessionCwd,
			scenario: options.scenario,
			resourceContext,
			peripherals,
			modelAdapter: options.modelAdapter,
			extensionEvents,
			mcpCoordinator: options.mcpCoordinator,
			readSessionId: () => activeSessionId,
			resolveConversationPath: options.conversation.resolveConversationPath,
			readConversationModelMessages: options.readConversationModelMessages,
			createChildComposition: options.createChildComposition,
			trackContextRuntime: (runtime) => options.registry.trackContextRuntime(runtime),
			untrackContextRuntime: (runtime) => options.registry.untrackContextRuntime(runtime),
			deferRollback: (task) => {
				rollback.defer(task);
			},
		});
		const {
			baseProfile,
			configurationState,
			executionRuntime,
			mcpController,
			memoryRuntime,
			pluginMcpRuntime,
			pluginRuntime,
			productToolFeature,
			productToolRegistrations,
			todoEnabled,
			todoRegistration,
			todoRuntime,
		} = peripherals;
		const { contextRuntime, hookRuntime, memoryController, modelRuntime, subagentRuntime } = context;
		const resourceLifecycleAssembly = createGreenfieldSessionResourceLifecycleAssembly({
			session: {
				initialSessionId: sessionOptions.sessionId,
				readSessionId: () => activeSessionId,
				commitSessionId: (sessionId) => {
					activeSessionId = sessionId;
				},
				cwd: sessionCwd,
				parentSessionPath: sessionOptions.parentSessionPath,
				parentEntryId: sessionOptions.parentEntryId,
			},
			conversation: options.conversation,
			ownership: {
				rebind: async (sessionId) => {
					await options.rebindOwnership(activeOwnership, sessionId);
				},
				release: async () => {
					await options.releaseOwnership(activeOwnership);
					activeOwnership = undefined;
				},
			},
			resourceContext,
			indexes: options.registry.indexes,
			hookRuntime,
			extensionEvents,
			extensionToolRuntime: options.extensionToolRuntime,
			conversationContextOverlay: options.conversationContextOverlay,
			modelRuntime,
			contextRuntime,
			memoryRuntime,
			memoryController,
			todoRuntime,
			todoToolRegistration: todoRegistration,
			todoEnabled,
			subagentRuntime,
			executionRuntime,
			configurationState,
			pluginMcpRuntime,
			mcpController,
			codingTools: options.codingTools,
			productToolRegistrations,
			activation: options.activation,
			knowledgeAvailable: options.knowledgeAvailable,
			backgroundTasksAvailable: options.backgroundTasksAvailable,
			askUserQuestion: sessionOptions.askUserQuestion,
			scenario: options.scenario,
			refreshSessionMcp: (sessionId, reportPromptBoundary) =>
				options.mcpCoordinator.refreshSession(sessionId, reportPromptBoundary),
			tracking: {
				trackHookSessionDisposer: (dispose) => options.registry.trackHookSessionDisposer(dispose),
				untrackHookSessionDisposer: (dispose) => options.registry.untrackHookSessionDisposer(dispose),
				untrackContextRuntime: (runtime) => options.registry.untrackContextRuntime(runtime),
				untrackMemoryRuntime: (runtime) => options.registry.untrackMemoryRuntime(runtime),
				untrackTodoRuntime: (runtime) => options.registry.untrackTodoRuntime(runtime),
				untrackTurnCapabilityAssembly: (assembly) => options.registry.untrackTurnCapabilityAssembly(assembly),
			},
		});
		rollback.defer({
			id: "hook-session",
			rollback: () => resourceLifecycleAssembly.disposeHookSession(),
		});
		const turnCapabilityAssembly = await createGreenfieldTurnCapabilitySessionAssembly({
			session: {
				initialSessionId: activeSessionId,
				readSessionId: () => activeSessionId,
				cwd: sessionCwd,
				scenario: options.scenario,
				agentDir: profile.agentDir,
				includeAgentSkills: sessionOptions.includeAgentSkills,
				systemPromptAddon: sessionOptions.systemPromptAddon,
			},
			activation: {
				resolve: (context) => options.resolveActivation(context, configurationState.readAgentMode()),
				readAgentMode: () => configurationState.readAgentMode(),
				readAgentPlugins: () => configurationState.readAgentPlugins(),
				readActiveToolNamesOverride: () => configurationState.readActiveToolNamesOverride(),
			},
			prompt: {
				systemPromptOptionsResolver:
					profile.createSystemPromptOptionsResolver?.(sessionOptions) ?? profile.resolveSystemPromptOptions,
				promptResourceResolver:
					profile.createPromptResourceResolver?.(sessionOptions, todoRuntime) ?? profile.resolvePromptResource,
				resourceSource: profile.promptResourceSource,
				settingsSource: profile.promptSettingsSource,
				systemPromptAdvertisedToolNames: profile.systemPromptAdvertisedToolNames,
			},
			baseProfile,
			codingTools: options.codingTools,
			executionRuntime,
			productToolFeature,
			productToolRegistrations,
			todoRuntime,
			todoToolRegistration: todoEnabled ? todoRegistration : undefined,
			memoryRuntime,
			subagentRuntime,
			contextRuntime,
			conversationContextProjector: options.conversationContextOverlay,
			modelRuntime,
			hookRuntime,
			pluginRuntime,
			pluginMcpRuntime,
			mcpController,
			extensionEvents,
			extensionToolRuntime: options.extensionToolRuntime,
		});
		options.registry.trackTurnCapabilityAssembly(turnCapabilityAssembly);
		rollback.defer({
			id: "capability-composition",
			rollback: async () => {
				try {
					await turnCapabilityAssembly.dispose();
				} finally {
					options.registry.untrackTurnCapabilityAssembly(turnCapabilityAssembly);
				}
			},
		});
		await turnCapabilityAssembly.previewInitialSystemPrompt();
		const resources = resourceLifecycleAssembly.attachTurnCapabilityAssembly(turnCapabilityAssembly);
		rollback.defer({
			id: "session-bindings",
			rollback: () => resourceLifecycleAssembly.rollbackBindings(),
		});
		rollback.commit();
		return resources;
	} catch (error) {
		return rollback.rollback(error, "Greenfield session resource initialization and rollback failed");
	}
}
