import type {
	ConversationEvent,
	PluginAgentToolApi,
	PluginAgentToolHandler,
	PluginAppActionHandler,
	PluginAppActionReadyHandler,
	PluginCodingAgentHookEventName,
	PluginCodingAgentHookHandler,
	PluginContinuationHandler,
	PluginMediaProviderRegistration,
	PluginSystemPromptProviderHandler,
} from "@vetta-org/plugin-sdk";

export interface PluginAgentToolHandlerEntry {
	handler: PluginAgentToolHandler;
	api: PluginAgentToolApi;
	activationId?: string;
}

export interface PluginAgentHookHandlerEntry {
	handler: PluginCodingAgentHookHandler<PluginCodingAgentHookEventName>;
	api: PluginAgentToolApi;
	activationId?: string;
}

export interface PluginAppActionHandlerEntry {
	handler: PluginAppActionHandler;
	assertReady?: PluginAppActionReadyHandler;
}

export interface PluginContinuationHandlerEntry {
	handler: PluginContinuationHandler;
	api: PluginAgentToolApi;
	activationId?: string;
}

export interface PluginSystemPromptHandlerEntry {
	handler: PluginSystemPromptProviderHandler;
	api: PluginAgentToolApi;
	activationId?: string;
}

export type PluginConversationListener = (event: ConversationEvent) => void;

export interface PluginHostBridgeRuntimeState {
	readonly version: 1;
	readonly agentToolHandlers: Map<string, PluginAgentToolHandlerEntry>;
	readonly agentHookHandlers: Map<string, PluginAgentHookHandlerEntry>;
	readonly appActionHandlers: Map<string, PluginAppActionHandlerEntry>;
	readonly appActionInvocations: Map<string, { controller: AbortController; handlerKey: string }>;
	readonly continuationHandlers: Map<string, PluginContinuationHandlerEntry>;
	readonly systemPromptHandlers: Map<string, PluginSystemPromptHandlerEntry>;
	readonly mediaProviderHandlers: Map<string, PluginMediaProviderRegistration>;
	readonly conversationListeners: Set<PluginConversationListener>;
	readonly listenerStarted: {
		translator: boolean;
		toolRequest: boolean;
		hookRequest: boolean;
		hookRelease: boolean;
		appActionRequest: boolean;
		continuationRequest: boolean;
		systemPromptRequest: boolean;
		mediaProviderRequest: boolean;
	};
	currentRuntimeId: string | null;
	currentConversationUnsubscribe: (() => void) | null;
	readonly sendMessageRef: {
		current:
			| ((
					text: string,
					options?: { source?: "plugin" },
			  ) => Promise<
					{ status: "sent" | "queued" | "failed"; error?: { message: string }; queueItemId?: string } | undefined
			  >)
			| null;
	};
}

const RUNTIME_STATE_KEY = "__vettaPluginHostBridgeRuntimeState_v1";

/**
 * Renderer-global ownership keeps IPC listeners and handler closures single-instance when
 * Vite re-evaluates the bridge module during HMR. A full renderer process still gets a fresh state.
 */
export function getPluginHostBridgeRuntimeState(): PluginHostBridgeRuntimeState {
	const host = globalThis as unknown as Record<string, unknown>;
	const existing = host[RUNTIME_STATE_KEY];
	if (isPluginHostBridgeRuntimeState(existing)) return existing;
	const state = createPluginHostBridgeRuntimeState();
	host[RUNTIME_STATE_KEY] = state;
	return state;
}

function createPluginHostBridgeRuntimeState(): PluginHostBridgeRuntimeState {
	return {
		version: 1,
		agentToolHandlers: new Map(),
		agentHookHandlers: new Map(),
		appActionHandlers: new Map(),
		appActionInvocations: new Map(),
		continuationHandlers: new Map(),
		systemPromptHandlers: new Map(),
		mediaProviderHandlers: new Map(),
		conversationListeners: new Set(),
		listenerStarted: {
			translator: false,
			toolRequest: false,
			hookRequest: false,
			hookRelease: false,
			appActionRequest: false,
			continuationRequest: false,
			systemPromptRequest: false,
			mediaProviderRequest: false,
		},
		currentRuntimeId: null,
		currentConversationUnsubscribe: null,
		sendMessageRef: { current: null },
	};
}

function isPluginHostBridgeRuntimeState(value: unknown): value is PluginHostBridgeRuntimeState {
	return typeof value === "object" && value !== null && "version" in value && value.version === 1;
}
