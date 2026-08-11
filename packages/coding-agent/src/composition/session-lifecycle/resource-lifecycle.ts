import type { EcosystemHookRuntime, SessionEndCause, SessionStartSource } from "@vetta/ecosystem-adapter";
import {
	type ConversationScenario,
	RetryableCleanup,
	type RuntimeResourceContext,
	type RuntimeResources,
	type RuntimeSessionAskUserQuestionCapability,
} from "@vetta/runtime-core";
import type { McpDeferredToolController, McpRuntimeToolSnapshot } from "@vetta/runtime-mcp";
import type { CodingToolActivation } from "@vetta/runtime-tools/coding";
import type { CodingAgentContextRuntime } from "../../adapters/runtime-core/context-runtime/index.js";
import type { CodingAgentExtensionRunAdapter } from "../../adapters/runtime-core/extension-run-adapter.js";
import type { CodingAgentExtensionToolRuntime } from "../../extensions/runtime/extension-tool-runtime.js";
import type { CodingAgentSessionConfigurationState } from "../../host/session-configuration/configuration-state.js";
import type { CodingAgentSessionExecutionRuntime } from "../../host/session-execution/execution-runtime.js";
import type { CodingAgentMemoryController, CodingAgentMemoryRolloverRuntime } from "../../memory/index.js";
import type { CodingAgentPluginMcpRuntime, CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";
import type { CodingAgentConversationContextOverlay } from "../../sessions/projection/conversation-context-overlay.js";
import type { CodingAgentTodoRuntime } from "../../work-state/contracts.js";
import type { CodingAgentSubagentRuntime } from "../subagent/runtime.js";
import type { CodingToolsRuntimeComposition } from "../tool-surface/runtime-tools-composition.js";
import type { CodingAgentTurnCapabilitySessionAssembly } from "../turn/capability-session-assembly.js";
import type { CodingAgentSessionMarkerIndex, CodingAgentSessionValueIndex } from "./indexes.js";
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
	readonly mcpControllers: CodingAgentSessionValueIndex<McpDeferredToolController>;
	readonly pluginMcpRuntimes: CodingAgentSessionValueIndex<CodingAgentPluginMcpRuntime>;
	readonly executionRuntimes: CodingAgentSessionValueIndex<CodingAgentSessionExecutionRuntime>;
	readonly configurationStates: CodingAgentSessionValueIndex<CodingAgentSessionConfigurationState>;
	readonly resourceContexts: CodingAgentSessionValueIndex<RuntimeResourceContext>;
	readonly extensionEventBridges: CodingAgentSessionValueIndex<CodingAgentExtensionRunAdapter>;
	readonly memoryControllers: CodingAgentSessionValueIndex<CodingAgentMemoryController>;
	readonly hookSessionControllers: CodingAgentSessionValueIndex<CodingAgentSessionHookController>;
	readonly mcpRefreshObservedSessions: CodingAgentSessionMarkerIndex;
	readonly mcpPromptRefreshReuseSessions: CodingAgentSessionMarkerIndex;
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
	readonly extensionEvents: CodingAgentExtensionRunAdapter;
	readonly extensionToolRuntime?: CodingAgentExtensionToolRuntime;
	readonly conversationContextOverlay: CodingAgentConversationContextOverlay;
	readonly modelRuntime: CodingAgentSessionModelRuntimePort;
	readonly contextRuntime: CodingAgentContextRuntime;
	readonly memoryRuntime?: CodingAgentMemoryRolloverRuntime;
	readonly memoryController?: CodingAgentMemoryController;
	readonly todoRuntime: CodingAgentTodoRuntime;
	readonly todoToolRegistration: CodingAgentRuntimeToolRegistration;
	readonly todoEnabled: boolean;
	readonly subagentRuntime?: CodingAgentSubagentRuntime;
	readonly executionRuntime: CodingAgentSessionExecutionRuntime;
	readonly configurationState: CodingAgentSessionConfigurationState;
	readonly pluginMcpRuntime?: CodingAgentPluginMcpRuntime;
	readonly mcpController?: McpDeferredToolController;
	readonly codingTools: CodingToolsRuntimeComposition;
	readonly productToolRegistrations: readonly CodingAgentRuntimeToolRegistration[];
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
		untrackTodoRuntime(runtime: CodingAgentTodoRuntime): void;
		untrackTurnCapabilityAssembly(assembly: CodingAgentTurnCapabilitySessionAssembly): void;
	};
}

export interface CodingAgentSessionResourceLifecycle {
	readonly hookController: CodingAgentSessionHookController;
	disposeHookSession(): Promise<void>;
	attachTurnCapabilityAssembly(assembly: CodingAgentTurnCapabilitySessionAssembly): RuntimeResources;
	rollbackBindings(): void;
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
		attachTurnCapabilityAssembly(assembly) {
			if (attachedAssembly) throw new Error("Session Resource Lifecycle is already attached");
			attachedAssembly = assembly;
			bindAttachedResources(options, hookController, disposeHookSession);
			return createResources(options, assembly, hookController, endHookSession);
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
	options.indexes.mcpPromptRefreshReuseSessions.delete(sessionId);
	options.tracking.untrackHookSessionDisposer(disposeHookSession);
}

function createResources(
	options: CodingAgentSessionResourceLifecycleOptions,
	turnCapabilityAssembly: CodingAgentTurnCapabilitySessionAssembly,
	hookController: CodingAgentSessionHookController,
	endHookSession: (cause: SessionEndCause) => Promise<void>,
): RuntimeResources {
	const sessionCleanup = createSessionCleanup(options, turnCapabilityAssembly, hookController, endHookSession);
	return createCodingAgentSessionRuntimeResources({
		session: options.session,
		conversation: options.conversation,
		turnCapabilityAssembly,
		modelRuntime: options.modelRuntime,
		todoRuntime: options.todoRuntime,
		contextRuntime: options.contextRuntime,
		subagentRuntime: options.subagentRuntime,
		executionRuntime: options.executionRuntime,
		configurationState: options.configurationState,
		pluginMcpRuntime: options.pluginMcpRuntime,
		extensionToolRuntime: options.extensionToolRuntime,
		codingTools: options.codingTools,
		productToolRegistrations: options.productToolRegistrations,
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
			await options.ownership.rebind(result.sessionId);
			options.session.commitSessionId(result.sessionId);
			options.indexes.mcpRefreshObservedSessions.rebind(previousSessionId, result.sessionId);
			options.indexes.mcpPromptRefreshReuseSessions.rebind(previousSessionId, result.sessionId);
			turnCapabilityAssembly.rebindSession(result.sessionId);
			rebindSessionIndexes(options, hookController, previousSessionId, result.sessionId);
			options.extensionToolRuntime?.rebindSession(previousSessionId, result.sessionId);
		},
		dispose: () => sessionCleanup.run("Failed to dispose session assembly resources"),
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
	if (options.subagentRuntime) {
		const subagentRuntime = options.subagentRuntime;
		cleanup.add({ id: "subagent-runtime", phase: 0, cleanup: () => subagentRuntime.dispose() });
	}
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
		id: "todo-runtime",
		phase: 0,
		cleanup: async () => {
			await options.todoRuntime.dispose();
			options.tracking.untrackTodoRuntime(options.todoRuntime);
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
	options.indexes.mcpPromptRefreshReuseSessions.delete(sessionId);
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
