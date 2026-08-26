import type { EcosystemHookRuntime, SessionEndCause, SessionStartSource } from "@vetta/ecosystem-adapter";
import {
	type ConversationScenario,
	RetryableCleanup,
	type RuntimeAgentSessionActivationContext,
	type RuntimeResourceContext,
	type RuntimeResources,
	type RuntimeSessionAskUserQuestionCapability,
	type RuntimeSessionMarkerIndex,
	type RuntimeSessionValueIndex,
} from "@vetta/runtime-core";
import type { SessionExtensionComposition } from "@vetta/runtime-core/session-extensions";
import type { McpDeferredToolController, McpRuntimeToolSnapshot } from "@vetta/runtime-mcp";
import type { CodingToolActivation } from "@vetta/runtime-tools";
import type { CodingAgentSessionExecutionRuntime } from "../../execution/session/runtime.js";
import type { CodingAgentExtensionRunBridge } from "../../extensions/runtime/extension-run-bridge.js";
import type { CodingAgentExtensionToolRuntime } from "../../extensions/runtime/extension-tool-runtime.js";
import type { CodingAgentSessionConfigurationState } from "../../host/session-configuration/configuration-state.js";
import type { CodingAgentMemoryController, CodingAgentMemoryRolloverRuntime } from "../../memory/index.js";
import type {
	CodingAgentContextRuntime,
	CodingAgentPluginMcpRuntime,
	CodingAgentRuntimeToolRegistration,
} from "../../runtime-contracts/index.js";
import type { CodingAgentConversationContextOverlay } from "../../sessions/projection/conversation-context-overlay.js";
import type { CodingAgentSubagentRuntime } from "../subagent/runtime.js";
import type { CodingToolsRuntimeComposition } from "../tool-surface/runtime-tools-composition.js";
import type { CodingAgentTurnCapabilitySessionAssembly } from "../turn/capability-session-assembly.js";
import {
	type CodingAgentSessionConversationResources,
	type CodingAgentSessionModelRuntimePort,
	createCodingAgentSessionRuntimeResources,
} from "./runtime-resources.js";

export interface CodingAgentSessionHookController {
	end(cause: SessionEndCause): Promise<void>;
	start(source: SessionStartSource): void;
	discard(): void;
}

export interface CodingAgentSessionResourceIndexes {
	readonly mcpControllers: RuntimeSessionValueIndex<McpDeferredToolController>;
	readonly pluginMcpRuntimes: RuntimeSessionValueIndex<CodingAgentPluginMcpRuntime>;
	readonly executionRuntimes: RuntimeSessionValueIndex<CodingAgentSessionExecutionRuntime>;
	readonly configurationStates: RuntimeSessionValueIndex<CodingAgentSessionConfigurationState>;
	readonly resourceContexts: RuntimeSessionValueIndex<RuntimeResourceContext>;
	readonly extensionEventBridges: RuntimeSessionValueIndex<CodingAgentExtensionRunBridge>;
	readonly memoryControllers: RuntimeSessionValueIndex<CodingAgentMemoryController>;
	readonly hookSessionControllers: RuntimeSessionValueIndex<CodingAgentSessionHookController>;
	readonly mcpRefreshObservedSessions: RuntimeSessionMarkerIndex;
}

export interface CodingAgentSessionResourceLifecycleOptions {
	readonly session: {
		readonly initialSessionId: string;
		readonly readSessionId: () => string;
		readonly commitSessionId: (sessionId: string) => void;
		readonly cwd: string;
		readonly parentSessionPath?: string;
		readonly parentEntryId?: string;
	};
	readonly conversation: CodingAgentSessionConversationResources;
	readonly ownership: {
		rebind(sessionId: string): Promise<void>;
		release(): Promise<void>;
	};
	readonly resourceContext: RuntimeResourceContext;
	readonly indexes: CodingAgentSessionResourceIndexes;
	readonly hookRuntime: EcosystemHookRuntime;
	readonly extensionEvents: CodingAgentExtensionRunBridge;
	readonly extensionToolRuntime?: CodingAgentExtensionToolRuntime;
	readonly conversationContextOverlay: CodingAgentConversationContextOverlay;
	readonly modelRuntime: CodingAgentSessionModelRuntimePort;
	readonly contextRuntime: CodingAgentContextRuntime;
	readonly memoryRuntime?: CodingAgentMemoryRolloverRuntime;
	readonly memoryController?: CodingAgentMemoryController;
	readonly sessionExtensions: SessionExtensionComposition;
	readonly todoToolRegistration: CodingAgentRuntimeToolRegistration;
	readonly todoEnabled: boolean;
	readonly subagentRuntime?: CodingAgentSubagentRuntime;
	readonly executionRuntime: CodingAgentSessionExecutionRuntime;
	readonly configurationState: CodingAgentSessionConfigurationState;
	readonly pluginMcpRuntime?: CodingAgentPluginMcpRuntime;
	readonly mcpController?: McpDeferredToolController;
	readonly codingTools: CodingToolsRuntimeComposition;
	readonly specializedToolRegistrations: readonly CodingAgentRuntimeToolRegistration[];
	readonly activation: CodingToolActivation;
	readonly knowledgeAvailable: boolean;
	readonly backgroundTasksAvailable: boolean;
	readonly askUserQuestion?: RuntimeSessionAskUserQuestionCapability;
	readonly scenario: ConversationScenario;
	readonly refreshSessionMcp: (
		sessionId: string,
		reportPromptBoundary: boolean,
	) => Promise<McpRuntimeToolSnapshot | undefined>;
	readonly tracking: {
		trackHookSessionDisposer(dispose: () => Promise<void>): void;
		untrackHookSessionDisposer(dispose: () => Promise<void>): void;
		untrackContextRuntime(runtime: CodingAgentContextRuntime): void;
		untrackMemoryRuntime(runtime: CodingAgentMemoryRolloverRuntime): void;
		untrackSessionExtensionComposition(composition: SessionExtensionComposition): void;
		untrackTurnCapabilityAssembly(assembly: CodingAgentTurnCapabilitySessionAssembly): void;
	};
}

export interface CodingAgentSessionResourceLifecycle {
	readonly hookController: CodingAgentSessionHookController;
	disposeHookSession(): Promise<void>;
	prepareTurnCapabilityAssembly(
		assembly: CodingAgentTurnCapabilitySessionAssembly,
	): CodingAgentPreparedSessionResourceLifecycle;
	rollbackBindings(): void;
}

export type CodingAgentCapabilitySessionBinding = RuntimeAgentSessionActivationContext;

export interface CodingAgentPreparedSessionResourceLifecycle {
	activate(binding: CodingAgentCapabilitySessionBinding): RuntimeResources;
	dispose(): Promise<void>;
}

/** 组装 Session 资源适配、Hook 生命周期、正常清理与 Conversation continuation 重绑定。 */
export function createCodingAgentSessionResourceLifecycle(
	options: CodingAgentSessionResourceLifecycleOptions,
): CodingAgentSessionResourceLifecycle {
	let hookSessionEnded = false;
	let attachedAssembly: CodingAgentTurnCapabilitySessionAssembly | undefined;
	const disposeHookSession = (): Promise<void> => endHookSession("dispose");
	const endHookSession = async (cause: SessionEndCause): Promise<void> => {
		if (hookSessionEnded) return;
		hookSessionEnded = true;
		options.tracking.untrackHookSessionDisposer(disposeHookSession);
		try {
			await options.hookRuntime.runSessionEnd(cause);
		} catch (error) {
			console.warn(`[ecosystem-hooks] SessionEnd failed during Runtime ${cause}`, error);
		}
	};
	const hookController: CodingAgentSessionHookController = {
		end: endHookSession,
		start(source) {
			if (hookSessionEnded) {
				hookSessionEnded = false;
				options.tracking.trackHookSessionDisposer(disposeHookSession);
			}
			options.hookRuntime.markSessionStart(source);
		},
		discard() {
			hookSessionEnded = true;
			options.tracking.untrackHookSessionDisposer(disposeHookSession);
		},
	};

	return {
		hookController,
		disposeHookSession,
		prepareTurnCapabilityAssembly(assembly) {
			if (attachedAssembly) throw new Error("Session Resource Lifecycle is already attached");
			attachedAssembly = assembly;
			bindAttachedResources(options, hookController, disposeHookSession);
			const sessionCleanup = createSessionCleanup(options, assembly, hookController, endHookSession);
			let activated = false;
			return {
				activate(binding) {
					if (activated) throw new Error("Session Resource Lifecycle is already activated");
					activated = true;
					return createResources(options, assembly, binding, hookController);
				},
				dispose: () => sessionCleanup.run("Failed to dispose session assembly resources"),
			};
		},
		rollbackBindings() {
			if (!attachedAssembly) return;
			unbindAttachedResources(options, hookController, disposeHookSession);
			attachedAssembly = undefined;
		},
	};
}

function bindAttachedResources(
	options: CodingAgentSessionResourceLifecycleOptions,
	hookController: CodingAgentSessionHookController,
	disposeHookSession: () => Promise<void>,
): void {
	const sessionId = options.session.readSessionId();
	options.indexes.extensionEventBridges.set(sessionId, options.extensionEvents);
	if (options.memoryController) options.indexes.memoryControllers.set(sessionId, options.memoryController);
	options.tracking.trackHookSessionDisposer(disposeHookSession);
	options.indexes.hookSessionControllers.set(sessionId, hookController);
}

function unbindAttachedResources(
	options: CodingAgentSessionResourceLifecycleOptions,
	hookController: CodingAgentSessionHookController,
	disposeHookSession: () => Promise<void>,
): void {
	const sessionId = options.session.readSessionId();
	options.indexes.extensionEventBridges.unbind(sessionId, options.extensionEvents);
	if (options.memoryController) options.indexes.memoryControllers.unbind(sessionId, options.memoryController);
	options.indexes.hookSessionControllers.unbind(sessionId, hookController);
	options.indexes.mcpRefreshObservedSessions.delete(sessionId);
	options.tracking.untrackHookSessionDisposer(disposeHookSession);
}

function createResources(
	options: CodingAgentSessionResourceLifecycleOptions,
	turnCapabilityAssembly: CodingAgentTurnCapabilitySessionAssembly,
	capabilitySession: CodingAgentCapabilitySessionBinding,
	hookController: CodingAgentSessionHookController,
): RuntimeResources {
	return createCodingAgentSessionRuntimeResources({
		session: options.session,
		conversation: options.conversation,
		turnCapabilityAssembly,
		capabilitySnapshotProvider: capabilitySession.snapshotProvider,
		modelRuntime: options.modelRuntime,
		sessionExtensions: options.sessionExtensions,
		contextRuntime: options.contextRuntime,
		subagentRuntime: options.subagentRuntime,
		executionRuntime: options.executionRuntime,
		configurationState: options.configurationState,
		pluginMcpRuntime: options.pluginMcpRuntime,
		extensionToolRuntime: options.extensionToolRuntime,
		codingTools: options.codingTools,
		specializedToolRegistrations: options.specializedToolRegistrations,
		todoToolRegistration: options.todoToolRegistration,
		todoEnabled: options.todoEnabled,
		memoryRuntime: options.memoryRuntime,
		mcpController: options.mcpController,
		activation: options.activation,
		knowledgeAvailable: options.knowledgeAvailable,
		backgroundTasksAvailable: options.backgroundTasksAvailable,
		askUserQuestion: options.askUserQuestion,
		scenario: options.scenario,
		refreshSessionMcp: options.refreshSessionMcp,
		onConversationContinued: async (result) => {
			const previousSessionId = options.session.readSessionId();
			options.conversationContextOverlay.clear(previousSessionId);
			options.conversationContextOverlay.clear(result.sessionId);
			await rebindSessionIdentity(options, capabilitySession, previousSessionId, result.sessionId);
			options.session.commitSessionId(result.sessionId);
			options.indexes.mcpRefreshObservedSessions.rebind(previousSessionId, result.sessionId);
			turnCapabilityAssembly.rebindSession(result.sessionId);
			rebindSessionIndexes(options, hookController, previousSessionId, result.sessionId);
			options.extensionToolRuntime?.rebindSession(previousSessionId, result.sessionId);
		},
		dispose: () => capabilitySession.dispose(),
	});
}

function createSessionCleanup(
	options: CodingAgentSessionResourceLifecycleOptions,
	turnCapabilityAssembly: CodingAgentTurnCapabilitySessionAssembly,
	hookController: CodingAgentSessionHookController,
	endHookSession: (cause: SessionEndCause) => Promise<void>,
): RetryableCleanup {
	const cleanup = new RetryableCleanup();
	cleanup.add({
		id: "conversation-context-overlay",
		phase: 0,
		cleanup: () => options.conversationContextOverlay.clear(options.session.readSessionId()),
	});
	cleanup.add({
		id: "session-tool-overlay",
		phase: 0,
		cleanup: () => options.extensionToolRuntime?.clearSessionTools(options.session.readSessionId()),
	});
	cleanup.add({
		id: "context-runtime",
		phase: 0,
		cleanup: () => {
			options.contextRuntime.dispose();
			options.tracking.untrackContextRuntime(options.contextRuntime);
		},
	});
	if (options.memoryRuntime) {
		const memoryRuntime = options.memoryRuntime;
		cleanup.add({
			id: "memory-runtime",
			phase: 0,
			cleanup: () => {
				memoryRuntime.dispose();
				options.tracking.untrackMemoryRuntime(memoryRuntime);
			},
		});
	}
	cleanup.add({
		id: "memory-controller-binding",
		phase: 0,
		cleanup: () => {
			if (options.memoryController) {
				options.indexes.memoryControllers.unbind(options.session.readSessionId(), options.memoryController);
			}
		},
	});
	cleanup.add({ id: "session-end-hook", phase: 0, cleanup: () => endHookSession("dispose") });
	if (options.pluginMcpRuntime) {
		const pluginMcpRuntime = options.pluginMcpRuntime;
		cleanup.add({
			id: "plugin-mcp-runtime",
			phase: 0,
			cleanup: async () => {
				await pluginMcpRuntime.dispose();
				options.indexes.pluginMcpRuntimes.unbind(options.session.readSessionId(), pluginMcpRuntime);
			},
		});
	}
	cleanup.add({
		id: "execution-runtime",
		phase: 0,
		cleanup: async () => {
			await options.executionRuntime.dispose();
			options.indexes.executionRuntimes.unbind(options.session.readSessionId(), options.executionRuntime);
		},
	});
	cleanup.add({
		id: "session-extensions",
		phase: 0,
		cleanup: async () => {
			await options.sessionExtensions.dispose();
			options.tracking.untrackSessionExtensionComposition(options.sessionExtensions);
		},
	});
	cleanup.add({
		id: "capability-composition",
		phase: 0,
		cleanup: async () => {
			await turnCapabilityAssembly.dispose();
			options.tracking.untrackTurnCapabilityAssembly(turnCapabilityAssembly);
		},
	});
	cleanup.add({
		id: "session-bindings",
		phase: 1,
		cleanup: () => unbindSessionResources(options, hookController),
	});
	cleanup.add({ id: "conversation-ownership", phase: 2, cleanup: () => options.ownership.release() });
	return cleanup;
}

async function rebindSessionIdentity(
	options: CodingAgentSessionResourceLifecycleOptions,
	capabilitySession: CodingAgentCapabilitySessionBinding,
	previousSessionId: string,
	nextSessionId: string,
): Promise<void> {
	await capabilitySession.rebindSession(nextSessionId);
	try {
		await options.ownership.rebind(nextSessionId);
	} catch (error) {
		try {
			await capabilitySession.rebindSession(previousSessionId);
		} catch (rollbackError) {
			throw new AggregateError([error, rollbackError], "Session continuation identity rebind and rollback failed");
		}
		throw error;
	}
}

function unbindSessionResources(
	options: CodingAgentSessionResourceLifecycleOptions,
	hookController: CodingAgentSessionHookController,
): void {
	const sessionId = options.session.readSessionId();
	options.indexes.hookSessionControllers.unbind(sessionId, hookController);
	if (options.mcpController) options.indexes.mcpControllers.unbind(sessionId, options.mcpController);
	options.indexes.configurationStates.unbind(sessionId, options.configurationState);
	options.indexes.resourceContexts.unbind(sessionId, options.resourceContext);
	options.indexes.extensionEventBridges.unbind(sessionId, options.extensionEvents);
	options.indexes.mcpRefreshObservedSessions.delete(sessionId);
}

function rebindSessionIndexes(
	options: CodingAgentSessionResourceLifecycleOptions,
	hookController: CodingAgentSessionHookController,
	previousSessionId: string,
	nextSessionId: string,
): void {
	if (options.memoryController) {
		options.indexes.memoryControllers.rebind(previousSessionId, nextSessionId, options.memoryController);
	}
	if (options.mcpController) {
		options.indexes.mcpControllers.rebind(previousSessionId, nextSessionId, options.mcpController);
	}
	if (options.pluginMcpRuntime) {
		options.indexes.pluginMcpRuntimes.rebind(previousSessionId, nextSessionId, options.pluginMcpRuntime);
	}
	options.indexes.executionRuntimes.rebind(previousSessionId, nextSessionId, options.executionRuntime);
	options.indexes.configurationStates.rebind(previousSessionId, nextSessionId, options.configurationState);
	options.indexes.resourceContexts.rebind(previousSessionId, nextSessionId, options.resourceContext);
	options.indexes.extensionEventBridges.rebind(previousSessionId, nextSessionId, options.extensionEvents);
	options.indexes.hookSessionControllers.rebind(previousSessionId, nextSessionId, hookController);
}
