import type { Message } from "@vetta/ai";
import {
	type ConversationScenario,
	InitializationRollbackScope,
	type RuntimeAgentSessionPlan,
	type RuntimeAgentSessionPreparationContext,
	type RuntimeObservationPublisher,
	type RuntimeResourceContext,
} from "@vetta/runtime-core";
import type { ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import type { CodingToolActivation } from "@vetta/runtime-tools";
import type { CodingAgentRuntimeModelAdapter } from "../../adapters/runtime-core/model-runtime-adapter.js";
import { CodingAgentExtensionRunBridge } from "../../extensions/runtime/extension-run-bridge.js";
import type { CodingAgentExtensionToolRuntime } from "../../extensions/runtime/extension-tool-runtime.js";
import type { CodingAgentConversationContextOverlay } from "../../sessions/projection/conversation-context-overlay.js";
import type { CodingAgentConversationSessionPathAssessment } from "../contracts/conversation-persistence.js";
import type { CodingAgentRuntimeSessionOptions } from "../contracts/index.js";
import type { CodingAgentSessionResourceIndexes } from "../session-lifecycle/resource-lifecycle.js";
import { createCodingAgentSessionResourceLifecycle } from "../session-lifecycle/resource-lifecycle.js";
import type { CodingAgentSessionConversationResources } from "../session-lifecycle/runtime-resources.js";
import type {
	CodingAgentSubagentChildComposition,
	CodingAgentSubagentChildCompositionRequest,
} from "../subagent/session-assembly.js";
import type { CodingAgentMcpSessionCoordinator } from "../tool-surface/mcp-session-coordinator.js";
import type { CodingToolsRuntimeComposition } from "../tool-surface/runtime-tools-composition.js";
import { createCodingAgentTurnCapabilitySessionAssembly } from "../turn/capability-session-assembly.js";
import type { CodingAgentImageSettingsSnapshotRouter } from "../turn/image-settings-snapshot-router.js";
import { createCodingAgentSessionContextAssembly } from "./context-assembly.js";
import { createCodingAgentSessionInitializationTimeline } from "./initialization-timeline.js";
import { createCodingAgentSessionPeripheralAssembly } from "./peripheral-assembly.js";
import type { CodingAgentSessionInitializationProfile } from "./profile.js";

export interface CodingAgentSessionInitializationRegistry {
	readonly indexes: CodingAgentSessionResourceIndexes;
}

export interface CodingAgentSessionInitializationTransactionOptions<TOwnershipBinding> {
	readonly profile: CodingAgentSessionInitializationProfile;
	readonly cwd: string;
	readonly scenario: ConversationScenario;
	readonly activation: CodingToolActivation;
	readonly knowledgeAvailable: boolean;
	readonly backgroundTasksAvailable: boolean;
	readonly codingTools: CodingToolsRuntimeComposition;
	readonly registry: CodingAgentSessionInitializationRegistry;
	readonly mcpCoordinator: CodingAgentMcpSessionCoordinator;
	readonly conversation: CodingAgentSessionConversationResources;
	readonly readConversationModelMessages: (sessionId: string) => Promise<readonly Message[]>;
	readonly conversationContextOverlay: CodingAgentConversationContextOverlay;
	readonly modelAdapter: CodingAgentRuntimeModelAdapter;
	readonly extensionToolRuntime?: CodingAgentExtensionToolRuntime;
	readonly acquireOwnership: (sessionId: string) => Promise<TOwnershipBinding | undefined>;
	readonly rebindOwnership: (binding: TOwnershipBinding | undefined, sessionId: string) => Promise<void>;
	readonly releaseOwnership: (binding: TOwnershipBinding | undefined) => Promise<void>;
	readonly resolveActivation: (
		context: ModelCallContributionContext,
		activeToolNamesOverride?: readonly string[],
	) => CodingToolActivation;
	readonly createChildComposition: (
		request: CodingAgentSubagentChildCompositionRequest,
	) => Promise<CodingAgentSubagentChildComposition>;
	readonly assessChildSessionPath: (
		conversationDir: string,
		sessionId: string,
		sessionPath: string,
	) => Promise<CodingAgentConversationSessionPathAssessment>;
	readonly imageSettingsSnapshots: CodingAgentImageSettingsSnapshotRouter;
}

export interface CodingAgentSessionInitializationTransaction {
	prepare(
		sessionOptions: CodingAgentRuntimeSessionOptions,
		resourceContext: RuntimeResourceContext,
		agentSessionContext: RuntimeAgentSessionPreparationContext,
	): Promise<RuntimeAgentSessionPlan>;
}

/** 创建单个 Session 的完整对象图，并在提交前统一持有初始化失败回滚责任。 */
export function createCodingAgentSessionInitializationTransaction<TOwnershipBinding>(
	options: CodingAgentSessionInitializationTransactionOptions<TOwnershipBinding>,
): CodingAgentSessionInitializationTransaction {
	return {
		prepare: (sessionOptions, resourceContext, agentSessionContext) =>
			initializeSession(options, sessionOptions, resourceContext, agentSessionContext.observationPublisher),
	};
}

async function initializeSession<TOwnershipBinding>(
	options: CodingAgentSessionInitializationTransactionOptions<TOwnershipBinding>,
	sessionOptions: CodingAgentRuntimeSessionOptions,
	resourceContext: RuntimeResourceContext,
	agentSessionObservations: RuntimeObservationPublisher,
): Promise<RuntimeAgentSessionPlan> {
	const profile = options.profile;
	let activeSessionId = sessionOptions.sessionId;
	const timeline = createCodingAgentSessionInitializationTimeline({
		sessionId: sessionOptions.sessionId,
		operation: resourceContext.operation,
		observationPublisher: agentSessionObservations,
	});
	let activeOwnership: TOwnershipBinding | undefined;
	const rollback = new InitializationRollbackScope();
	const extensionEvents = new CodingAgentExtensionRunBridge(options.extensionToolRuntime?.runnerGenerations);
	try {
		activeOwnership = await timeline.measure("ownership", () => options.acquireOwnership(activeSessionId));
		rollback.defer({
			id: "conversation-ownership",
			rollback: async () => {
				await options.releaseOwnership(activeOwnership);
				activeOwnership = undefined;
			},
		});
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
		if (sessionOptions.sessionTools) {
			options.extensionToolRuntime?.replaceSessionTools(activeSessionId, sessionOptions.sessionTools);
			rollback.defer({
				id: "session-tool-overlay",
				rollback: () => options.extensionToolRuntime?.clearSessionTools(activeSessionId),
			});
		}
		const sessionCwd = sessionOptions.cwd ?? options.cwd;
		const peripherals = await timeline.measure("peripherals", () =>
			createCodingAgentSessionPeripheralAssembly({
				profile,
				sessionOptions,
				sessionCwd,
				scenario: options.scenario,
				activation: options.activation,
				codingTools: options.codingTools,
				indexes: options.registry.indexes,
				mcpCoordinator: options.mcpCoordinator,
				resourceContext,
				configurationSource: options.imageSettingsSnapshots,
				readSessionId: () => activeSessionId,
				resolveActivation: options.resolveActivation,
				deferRollback: (task) => {
					rollback.defer(task);
				},
			}),
		);
		const context = timeline.measureSync("context", () =>
			createCodingAgentSessionContextAssembly({
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
				assessChildSessionPath: options.assessChildSessionPath,
				observationPublisher: agentSessionObservations,
				deferRollback: (task) => {
					rollback.defer(task);
				},
			}),
		);
		const {
			baseCapabilities,
			configurationState,
			executionRuntime,
			mcpController,
			memoryRuntime,
			pluginMcpRuntime,
			pluginRuntime,
			specializedToolFeature,
			specializedToolRegistrations,
			sessionExtensions,
			todoEnabled,
			todoRegistration,
			todoRuntime,
		} = peripherals;
		const { contextRuntime, hookRuntime, memoryController, modelRuntime, subagentRuntime } = context;
		const resourceLifecycleAssembly = createCodingAgentSessionResourceLifecycle({
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
			sessionExtensions,
			todoToolRegistration: todoRegistration,
			todoEnabled,
			subagentRuntime,
			executionRuntime,
			configurationState,
			pluginMcpRuntime,
			mcpController,
			codingTools: options.codingTools,
			specializedToolRegistrations,
			activation: options.activation,
			knowledgeAvailable: options.knowledgeAvailable,
			backgroundTasksAvailable: options.backgroundTasksAvailable,
			askUserQuestion: sessionOptions.askUserQuestion,
			scenario: options.scenario,
			observationPublisher: agentSessionObservations,
		});
		rollback.defer({
			id: "hook-session",
			rollback: () => resourceLifecycleAssembly.disposeHookSession(),
		});
		const createPromptRuntimeSources = profile.createPromptRuntimeSources;
		const turnCapabilityAssembly = await timeline.measure("turn-capabilities", () =>
			createCodingAgentTurnCapabilitySessionAssembly({
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
					resolve: (context) =>
						options.resolveActivation(context, configurationState.readActiveToolNamesOverride()),
					readAgentMode: () => configurationState.readAgentMode(),
					readAgentPlugins: () => configurationState.readAgentPlugins(),
					readActiveToolNamesOverride: () => configurationState.readActiveToolNamesOverride(),
					bindForTurn: () => {
						const revision = configurationState.captureRevision();
						return {
							resolve: (context) => options.resolveActivation(context, revision.activeToolNamesOverride),
							agentMode: revision.agentMode,
							agentPlugins: revision.agentPlugins,
							activeToolNamesOverride: revision.activeToolNamesOverride,
						};
					},
				},
				prompt: {
					runtimeSourceFactory: createPromptRuntimeSources
						? ({ runtimeSkillPaths }) =>
								createPromptRuntimeSources({
									sessionOptions,
									cwd: sessionCwd,
									agentDir: profile.agentDir,
									scenario: options.scenario,
									runtimeSkillPaths,
								})
						: undefined,
					systemPromptOptionsResolver:
						profile.createSystemPromptOptionsResolver?.(sessionOptions) ?? profile.resolveSystemPromptOptions,
					promptResourceResolver:
						profile.createPromptResourceResolver?.(sessionOptions, todoRuntime) ?? profile.resolvePromptResource,
					resourceSource: profile.promptResourceSource,
					settingsSource: profile.promptSettingsSource,
					systemPromptAdvertisedToolNames: profile.systemPromptAdvertisedToolNames,
					workspaceFacts: profile.workspaceFacts,
					resolveModePrompt: profile.resolveModePrompt,
				},
				baseCapabilities: { ...baseCapabilities, observationPublisher: agentSessionObservations },
				codingTools: options.codingTools,
				executionRuntime,
				specializedToolFeature,
				specializedToolRegistrations,
				continuationSources: sessionExtensions.continuationSources,
				todoRuntime,
				todoToolRegistration: todoEnabled ? todoRegistration : undefined,
				memoryRuntime,
				subagentRuntime,
				contextRuntime,
				conversationContextProjector: options.conversationContextOverlay,
				modelRuntime,
				modelInputImageProcessor: profile.modelInputImageProcessor,
				hookRuntime,
				pluginRuntime,
				pluginMcpRuntime,
				mcpController,
				extensionEvents,
				extensionToolRuntime: options.extensionToolRuntime,
				askUserQuestion: sessionOptions.askUserQuestion,
				initializationTimeline: timeline,
				imageSettingsSnapshots: options.imageSettingsSnapshots,
			}),
		);
		rollback.defer({
			id: "capability-composition",
			rollback: () => turnCapabilityAssembly.dispose(),
		});
		const preparedResources = resourceLifecycleAssembly.prepareTurnCapabilityAssembly(turnCapabilityAssembly);
		rollback.defer({
			id: "session-bindings",
			rollback: () => resourceLifecycleAssembly.rollbackBindings(),
		});
		let activated = false;
		return {
			definition: {
				capabilities: turnCapabilityAssembly.capabilityDefinition,
				modelBindingProvider: modelRuntime,
			},
			beforeSnapshotAcquire: async (context) => {
				await options.mcpCoordinator.refreshSession(activeSessionId, context?.reason === "turn");
			},
			async activate(binding) {
				try {
					await timeline.measure("initial-system-prompt", () =>
						turnCapabilityAssembly.previewInitialSystemPrompt(binding.acquirePreviewSnapshot),
					);
					const resources = preparedResources.activate(binding);
					rollback.commit();
					activated = true;
					timeline.finish("completed");
					return resources;
				} catch (error) {
					timeline.finish("failed");
					throw error;
				}
			},
			onFailure: () => timeline.finish("failed"),
			dispose: () =>
				activated
					? preparedResources.dispose()
					: rollback.dispose("Coding Agent Session initialization rollback failed"),
		};
	} catch (error) {
		try {
			return await rollback.rollback(error, "Session resource initialization and rollback failed");
		} finally {
			timeline.finish("failed");
		}
	}
}
