import {
	activeSessionAtom,
	chatMessagesAtom,
	inputValueAtom,
	isStreamingAtom,
	languageAtom,
	promptAttachmentAtom,
	selectedModelAtom,
} from "@shared/store/atoms";
import type { Message } from "@vetta/ai";
import type { SessionEvent } from "@vetta/runtime-core";
import type {
	ConversationEvent,
	ConversationMessage,
	ConversationState,
	Disposable,
	PluginAgentActions,
	PluginAgentToolApi,
	PluginAgentToolHandler,
	PluginAppActionHandler,
	PluginAppActionReadyHandler,
	PluginContinuationHandler,
	PluginConversationApi,
	PluginDynamicSystemPromptOperation,
	PluginHostBridge,
	PluginMediaProviderJob,
	PluginMediaProviderRegistration,
	PluginMediaProviderSubmitRequest,
	PluginPromptAttachment,
	PluginSystemPromptProviderHandler,
} from "@vetta-org/plugin-sdk";
import { __setPluginHostBridge, PluginAppActionError } from "@vetta-org/plugin-sdk";
import { getDefaultStore, useAtomValue } from "jotai";
import { useMemo } from "react";

const store = getDefaultStore();

interface PluginAgentToolHandlerEntry {
	handler: PluginAgentToolHandler;
	api: PluginAgentToolApi;
}

const agentToolHandlers = new Map<string, PluginAgentToolHandlerEntry>();
interface PluginAppActionHandlerEntry {
	handler: PluginAppActionHandler;
	assertReady?: PluginAppActionReadyHandler;
}

const appActionHandlers = new Map<string, PluginAppActionHandlerEntry>();
const appActionInvocations = new Map<string, { controller: AbortController; handlerKey: string }>();
const continuationHandlers = new Map<string, { handler: PluginContinuationHandler; api: PluginAgentToolApi }>();
const systemPromptHandlers = new Map<string, { handler: PluginSystemPromptProviderHandler; api: PluginAgentToolApi }>();
const mediaProviderHandlers = new Map<string, PluginMediaProviderRegistration>();

function handlerKey(pluginId: string, handlerId: string): string {
	return `${pluginId}:${handlerId}`;
}

function createAgentActions(): {
	actions: PluginAgentActions;
	effects: PluginDynamicSystemPromptOperation[];
} {
	const effects: PluginDynamicSystemPromptOperation[] = [];
	return {
		effects,
		actions: {
			systemPrompt: {
				addBlock: (block) => effects.push({ type: "addBlock", block }),
				replaceBlock: (blockId, block) => effects.push({ type: "replaceBlock", blockId, block }),
				updateBlock: (blockId, patch) => effects.push({ type: "updateBlock", blockId, patch }),
				removeBlock: (blockId) => effects.push({ type: "removeBlock", blockId }),
				setBlockEnabled: (blockId, enabled) => effects.push({ type: "setBlockEnabled", blockId, enabled }),
			},
			tools: {
				setEnabled: (toolName, enabled) => effects.push({ type: "setToolEnabled", toolName, enabled }),
				enable: (toolName) => effects.push({ type: "setToolEnabled", toolName, enabled: true }),
				disable: (toolName) => effects.push({ type: "setToolEnabled", toolName, enabled: false }),
			},
			continuation: {
				request: (result) => effects.push({ type: "requestContinuation", result }),
			},
		},
	};
}

// ─── Conversation event bus ───
//
// An isolated translator: it watches activeSessionAtom and opens its OWN
// session.subscribe on the active session, translating SessionEvents into
// plugin-facing ConversationEvents. This keeps useSessionManager's large
// handler untouched — IPC supports multiple subscribers per session.

type Listener = (event: ConversationEvent) => void;
const listeners = new Set<Listener>();

function emit(event: ConversationEvent): void {
	for (const listener of listeners) {
		try {
			listener(event);
		} catch (error) {
			console.error("Plugin conversation listener threw", error);
		}
	}
}

function snapshot(): ConversationState {
	const active = store.get(activeSessionAtom);
	return {
		id: active?.runtimeId ?? null,
		cwd: active?.cwd ?? null,
		sessionPath: active?.sessionPath ?? null,
		model: store.get(selectedModelAtom),
		isStreaming: store.get(isStreamingAtom),
	};
}

function messageText(message: Message): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((block) =>
				block && typeof block === "object" && "text" in block
					? String((block as { text?: unknown }).text ?? "")
					: "",
			)
			.join("");
	}
	return "";
}

function translate(event: SessionEvent): void {
	switch (event.type) {
		case "session.lifecycle":
			if (event.phase === "agent_start") emit({ type: "turn-start" });
			else if (event.phase === "agent_end") emit({ type: "turn-end", stopReason: "stop" });
			else if (event.phase === "aborted") emit({ type: "turn-end", stopReason: "aborted" });
			return;
		case "message.delta":
			emit({ type: "message-updated", delta: event.delta });
			return;
		case "message.final":
			emit({
				type: "message-added",
				message: {
					id: event.eventId,
					role: (event.message.role === "user" ? "user" : "assistant") as ConversationMessage["role"],
					text: messageText(event.message),
					timestamp: event.timestamp,
				},
			});
			return;
		case "tool.start":
			emit({
				type: "tool-call-start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				// 透传工具入参（如 Edit/Write 的目标路径），供插件做「修改中」等
				// 定向 UI；与消息文本同属 agent.session.read 的可见面。
				args: (event.args as Record<string, unknown>) ?? undefined,
			});
			return;
		case "tool.end":
			emit({
				type: "tool-call-end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				isError: event.isError,
			});
			return;
		default:
			return;
	}
}

let translatorStarted = false;
let currentRuntimeId: string | null = null;
let currentUnsub: (() => void) | null = null;

function startTranslator(): void {
	if (translatorStarted) return;
	translatorStarted = true;

	const sync = (): void => {
		const active = store.get(activeSessionAtom);
		const runtimeId = active?.runtimeId ?? null;
		if (runtimeId === currentRuntimeId) return;
		currentRuntimeId = runtimeId;
		currentUnsub?.();
		currentUnsub = null;
		emit({ type: "conversation-changed", conversation: snapshot() });
		if (!runtimeId) return;
		void window.vetta.session
			.subscribe(runtimeId, translate)
			.then((unsub) => {
				// The active session may have changed again before subscribe resolved.
				if (currentRuntimeId === runtimeId) currentUnsub = unsub;
				else unsub();
			})
			.catch((error: Error) => console.error("Plugin conversation subscribe failed", error));
	};

	store.sub(activeSessionAtom, sync);
	sync();
}

let toolRequestListenerStarted = false;

function startToolRequestListener(): void {
	if (toolRequestListenerStarted) return;
	toolRequestListenerStarted = true;
	window.vetta.plugins.onAgentToolRequest((request) => {
		const entry = agentToolHandlers.get(handlerKey(request.pluginId, request.handlerId));
		if (!entry) {
			void window.vetta.plugins.respondAgentTool(request.requestId, {
				error: `Plugin tool handler not found: ${request.pluginId}/${request.handlerId}`,
			});
			return;
		}
		const execution = createAgentActions();
		void Promise.resolve(
			entry.handler({
				invocationId: request.requestId,
				plugin: {
					id: request.pluginId,
					contributionId: request.toolId,
					settings: request.settings,
				},
				session: {
					...request.session,
					scenario: request.session.scenario as Parameters<PluginAgentToolHandler>[0]["session"]["scenario"],
				},
				model: request.model,
				conversation: request.conversation,
				runtime: request.runtime,
				trigger: {
					...request.trigger,
					toolId: request.toolId,
					toolName: request.toolName,
					input: request.input,
				},
				actions: execution.actions,
				host: entry.api,
			}),
		).then(
			(value) =>
				window.vetta.plugins.respondAgentTool(request.requestId, {
					value,
					effects: execution.effects,
				}),
			(error: unknown) =>
				window.vetta.plugins.respondAgentTool(request.requestId, {
					error: error instanceof Error ? error.message : String(error),
				}),
		);
	});
}

let appActionRequestListenerStarted = false;

function startAppActionRequestListener(): void {
	if (appActionRequestListenerStarted) return;
	appActionRequestListenerStarted = true;
	window.vetta.plugins.onAppActionRequest((request) => {
		const key = handlerKey(request.pluginId, request.handlerId);
		const entry = appActionHandlers.get(key);
		if (!entry) {
			void window.vetta.plugins.respondAppAction(request.requestId, {
				error: `Plugin action handler not found: ${request.pluginId}/${request.handlerId}`,
			});
			return;
		}
		const controller = new AbortController();
		appActionInvocations.set(request.requestId, { controller, handlerKey: key });
		const context = {
			invocationId: request.requestId,
			plugin: {
				id: request.pluginId,
				actionId: request.actionId,
				settings: request.settings,
			},
			input: request.input,
			signal: controller.signal,
		};
		const invocation =
			request.phase === "assert-ready"
				? entry.assertReady
					? entry.assertReady(context)
					: Promise.reject(
							new Error(`Plugin action assertReady handler not found: ${request.pluginId}/${request.handlerId}`),
						)
				: entry.handler(context);
		void Promise.resolve(invocation).then(
			(value) => {
				appActionInvocations.delete(request.requestId);
				return window.vetta.plugins.respondAppAction(request.requestId, {
					value: request.phase === "assert-ready" ? null : value,
				});
			},
			(error: unknown) => {
				appActionInvocations.delete(request.requestId);
				return window.vetta.plugins.respondAppAction(request.requestId, {
					error:
						error instanceof PluginAppActionError
							? { code: error.code, message: error.message, details: error.details }
							: error instanceof Error
								? error.message
								: String(error),
				});
			},
		);
	});
	window.vetta.plugins.onAppActionCancel(({ requestId }) => {
		const invocation = appActionInvocations.get(requestId);
		if (!invocation) return;
		appActionInvocations.delete(requestId);
		invocation.controller.abort();
	});
}

let continuationRequestListenerStarted = false;

function startContinuationRequestListener(): void {
	if (continuationRequestListenerStarted) return;
	continuationRequestListenerStarted = true;
	window.vetta.plugins.onContinuationRequest((request) => {
		const entry = continuationHandlers.get(handlerKey(request.pluginId, request.handlerId));
		if (!entry) {
			void window.vetta.plugins.respondContinuation(request.requestId, {
				error: `Plugin continuation handler not found: ${request.pluginId}/${request.handlerId}`,
			});
			return;
		}
		const execution = createAgentActions();
		void Promise.resolve(
			entry.handler({
				invocationId: request.requestId,
				plugin: {
					id: request.pluginId,
					contributionId: request.providerId,
					settings: request.settings,
				},
				session: {
					...request.session,
					scenario: request.session.scenario as Parameters<PluginContinuationHandler>[0]["session"]["scenario"],
				},
				model: request.model,
				conversation: request.conversation,
				runtime: request.runtime,
				trigger: request.trigger,
				actions: execution.actions,
				host: entry.api,
			}),
		).then(
			(value) =>
				window.vetta.plugins.respondContinuation(request.requestId, {
					value,
					effects: execution.effects,
				}),
			(error: unknown) =>
				window.vetta.plugins.respondContinuation(request.requestId, {
					error: error instanceof Error ? error.message : String(error),
				}),
		);
	});
}

let systemPromptRequestListenerStarted = false;

function startSystemPromptRequestListener(): void {
	if (systemPromptRequestListenerStarted) return;
	systemPromptRequestListenerStarted = true;
	window.vetta.plugins.onSystemPromptRequest((request) => {
		const entry = systemPromptHandlers.get(handlerKey(request.pluginId, request.handlerId));
		if (!entry) {
			void window.vetta.plugins.respondSystemPrompt(request.requestId, {
				error: `Plugin system prompt handler not found: ${request.pluginId}/${request.handlerId}`,
			});
			return;
		}
		const execution = createAgentActions();
		void Promise.resolve(
			entry.handler({
				invocationId: request.requestId,
				plugin: {
					id: request.pluginId,
					contributionId: request.providerId,
					settings: request.settings,
				},
				session: {
					id: request.session.id,
					cwd: request.session.cwd,
					scenario: request.session
						.scenario as Parameters<PluginSystemPromptProviderHandler>[0]["session"]["scenario"],
				},
				model: request.model,
				conversation: request.conversation,
				runtime: request.runtime,
				trigger: request.trigger,
				systemPrompt: request.systemPrompt,
				actions: execution.actions,
				host: entry.api,
			}),
		).then(
			(value) => {
				if (Array.isArray(value)) execution.effects.push(...value);
				return window.vetta.plugins.respondSystemPrompt(request.requestId, {
					value: execution.effects,
					effects: [],
				});
			},
			(error: unknown) =>
				window.vetta.plugins.respondSystemPrompt(request.requestId, {
					error: error instanceof Error ? error.message : String(error),
				}),
		);
	});
}

let mediaProviderRequestListenerStarted = false;

function startMediaProviderRequestListener(): void {
	if (mediaProviderRequestListenerStarted) return;
	mediaProviderRequestListenerStarted = true;
	window.vetta.plugins.onMediaProviderRequest((request) => {
		const registration = mediaProviderHandlers.get(handlerKey(request.pluginId, request.handlerId));
		if (!registration) {
			void window.vetta.plugins.respondMediaProvider(request.requestId, {
				error: `Plugin media provider handler not found: ${request.pluginId}/${request.handlerId}`,
			});
			return;
		}
		const context = {
			invocationId: request.requestId,
			uploadInput: <T = unknown>(
				inputId: string,
				input: Parameters<typeof window.vetta.plugins.uploadMediaProviderInput>[2],
			) => window.vetta.plugins.uploadMediaProviderInput<T>(request.requestId, inputId, input),
		};
		let invocation: Promise<PluginMediaProviderJob> | undefined;
		if (request.operation === "submit") {
			invocation = registration.submit(request.input as PluginMediaProviderSubmitRequest, context);
		} else if (request.operation === "getJob") {
			invocation = registration.getJob?.((request.input as { jobId: string }).jobId, context);
		} else {
			invocation = registration.cancelJob?.((request.input as { jobId: string }).jobId, context);
		}
		if (!invocation) {
			void window.vetta.plugins.respondMediaProvider(request.requestId, {
				error: `Plugin media provider operation is unsupported: ${request.operation}`,
			});
			return;
		}
		void Promise.resolve(invocation).then(
			(value) => window.vetta.plugins.respondMediaProvider(request.requestId, { value }),
			(error: unknown) =>
				window.vetta.plugins.respondMediaProvider(request.requestId, {
					error: error instanceof Error ? error.message : String(error),
				}),
		);
	});
}

export function registerPluginAgentToolHandler(options: {
	pluginId: string;
	toolId: string;
	handlerId: string;
	handler: PluginAgentToolHandler;
	api: PluginAgentToolApi;
}): Disposable {
	const key = handlerKey(options.pluginId, options.handlerId);
	agentToolHandlers.set(key, { handler: options.handler, api: options.api });
	return {
		dispose: () => {
			const entry = agentToolHandlers.get(key);
			if (entry?.handler === options.handler) {
				agentToolHandlers.delete(key);
			}
		},
	};
}

export function registerPluginAppActionHandler(options: {
	pluginId: string;
	handlerId: string;
	handler: PluginAppActionHandler;
	assertReady?: PluginAppActionReadyHandler;
}): Disposable {
	const key = handlerKey(options.pluginId, options.handlerId);
	const entry: PluginAppActionHandlerEntry = {
		handler: options.handler,
		assertReady: options.assertReady,
	};
	appActionHandlers.set(key, entry);
	return {
		dispose: () => {
			if (appActionHandlers.get(key) === entry) appActionHandlers.delete(key);
			for (const [requestId, invocation] of appActionInvocations) {
				if (invocation.handlerKey !== key) continue;
				appActionInvocations.delete(requestId);
				invocation.controller.abort();
			}
		},
	};
}

export function registerPluginContinuationHandler(options: {
	pluginId: string;
	handlerId: string;
	handler: PluginContinuationHandler;
	api: PluginAgentToolApi;
}): Disposable {
	const key = handlerKey(options.pluginId, options.handlerId);
	continuationHandlers.set(key, { handler: options.handler, api: options.api });
	return {
		dispose: () => {
			if (continuationHandlers.get(key)?.handler === options.handler) {
				continuationHandlers.delete(key);
			}
		},
	};
}

export function registerPluginSystemPromptHandler(options: {
	pluginId: string;
	handlerId: string;
	handler: PluginSystemPromptProviderHandler;
	api: PluginAgentToolApi;
}): Disposable {
	const key = handlerKey(options.pluginId, options.handlerId);
	systemPromptHandlers.set(key, { handler: options.handler, api: options.api });
	return {
		dispose: () => {
			if (systemPromptHandlers.get(key)?.handler === options.handler) {
				systemPromptHandlers.delete(key);
			}
		},
	};
}

export function registerPluginMediaProviderHandler(options: {
	pluginId: string;
	handlerId: string;
	registration: PluginMediaProviderRegistration;
}): Disposable {
	const key = handlerKey(options.pluginId, options.handlerId);
	mediaProviderHandlers.set(key, options.registration);
	return {
		dispose: () => {
			if (mediaProviderHandlers.get(key) === options.registration) mediaProviderHandlers.delete(key);
		},
	};
}

// ─── Conversation actions ───

/** Set by useSessionManager so sendPrompt reuses the full send path. */
export const pluginSendMessageRef: { current: ((text: string) => Promise<void>) | null } = {
	current: null,
};

const conversation: PluginConversationApi = {
	sendPrompt: async (text: string): Promise<void> => {
		const send = pluginSendMessageRef.current;
		if (!send) throw new Error("No active conversation to send to");
		await send(text);
	},
	insertText: (text: string): void => {
		store.set(inputValueAtom, text);
	},
	abort: async (): Promise<void> => {
		const active = store.get(activeSessionAtom);
		if (active?.runtimeId) await window.vetta.session.abort(active.runtimeId);
	},
	on: (listener: Listener): Disposable => {
		listeners.add(listener);
		// 订阅即回放一次当前会话状态：插件在 activate 里订阅时，本轮的
		// conversation-changed 早已广播完（会话先于插件就绪，热更新更是如此），
		// 没有回放的话「按当前 cwd 决定标签卡显隐」这类逻辑要等到下次切会话才跑。
		// 走微任务，让 activate 先执行完再回调。
		let disposed = false;
		void Promise.resolve().then(() => {
			if (disposed) return;
			try {
				listener({ type: "conversation-changed", conversation: snapshot() });
			} catch (error) {
				console.error("Plugin conversation listener threw", error);
			}
		});
		return {
			dispose: () => {
				disposed = true;
				listeners.delete(listener);
			},
		};
	},
};

// ─── Hooks ───

function useActiveConversation(): ConversationState {
	const active = useAtomValue(activeSessionAtom);
	const isStreaming = useAtomValue(isStreamingAtom);
	const model = useAtomValue(selectedModelAtom);
	return useMemo(
		() => ({
			id: active?.runtimeId ?? null,
			cwd: active?.cwd ?? null,
			sessionPath: active?.sessionPath ?? null,
			model,
			isStreaming,
		}),
		[active, model, isStreaming],
	);
}

function useConversationMessages(): ConversationMessage[] {
	const messages = useAtomValue(chatMessagesAtom);
	return useMemo(
		() => messages.map((m) => ({ id: m.id, role: m.role, text: m.text, timestamp: m.timestamp })),
		[messages],
	);
}

function usePromptAttachment(): PluginPromptAttachment | null {
	return useAtomValue(promptAttachmentAtom);
}

function useLocale(): string {
	return useAtomValue(languageAtom);
}

/** The bridge the loader uses to build ctx.conversation (gated per plugin). */
export const pluginHostBridge: PluginHostBridge = {
	useActiveConversation,
	useConversationMessages,
	usePromptAttachment,
	useLocale,
	conversation,
};

let installed = false;

/** Inject the bridge into the shared plugin-sdk and start the event translator. */
export function installPluginHostBridge(): void {
	startTranslator();
	startToolRequestListener();
	startAppActionRequestListener();
	startContinuationRequestListener();
	startSystemPromptRequestListener();
	startMediaProviderRequestListener();
	if (installed) return;
	installed = true;
	__setPluginHostBridge(pluginHostBridge);
}
