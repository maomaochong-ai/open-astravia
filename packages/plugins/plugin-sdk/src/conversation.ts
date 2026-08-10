import type { Disposable } from "./disposable.js";

export interface ConversationState {
	/** Active session runtimeId, or null when no conversation is active. */
	id: string | null;
	cwd: string | null;
	sessionPath: string | null;
	model: string | null;
	isStreaming: boolean;
}

export interface ConversationMessage {
	id: string;
	role: "user" | "assistant" | "compaction";
	text: string;
	timestamp?: number;
}

export type ConversationEvent =
	| { type: "turn-start" }
	| { type: "turn-end"; stopReason: string }
	| { type: "message-added"; message: ConversationMessage }
	| { type: "message-updated"; delta: string }
	| { type: "tool-call-start"; toolCallId: string; toolName: string; args?: Record<string, unknown> }
	| { type: "tool-call-end"; toolCallId: string; toolName: string; isError: boolean }
	| { type: "conversation-changed"; conversation: ConversationState }
	| { type: "queue-changed"; queue: ConversationQueueState };

/** 会话输入队列快照（ADR-0060）：排队中的 prompt 与暂停状态。 */
export interface ConversationQueueState {
	/** abort/error 后队列暂停；恢复由用户在宿主 UI 操作。 */
	paused: boolean;
	items: Array<{ id: string; displayText: string }>;
}

/**
 * sendPrompt 的回执（ADR-0060）。streaming 中发送不再静默排队：返回 `queued` 与
 * 队列条目 id，插件可结合 `queue-changed` 事件呈现「已排队/已发出/被移除」状态。
 */
export interface SendPromptResult {
	status: "sent" | "queued";
	queueItemId?: string;
}

export interface PluginConversationApi {
	/**
	 * Send a prompt into the active conversation (renders as a user turn).
	 * Streaming 中会进入会话队列并立即 resolve `{ status: "queued" }`；
	 * 队列在本轮自然停止点接力消费，abort/error 后暂停待用户处置。
	 */
	sendPrompt(text: string): Promise<SendPromptResult>;
	/** Fill the input bar without sending; the user can edit and send. */
	insertText(text: string): void;
	/** Abort the active conversation's current turn. */
	abort(): Promise<void>;
	/**
	 * Subscribe to real-time conversation events. The listener is replayed one
	 * `conversation-changed` with the current state right after subscribing (in a
	 * microtask), so logic keyed off the active conversation — e.g. deciding
	 * whether an activity tab belongs in the tab bar for this cwd — runs without
	 * waiting for the next session switch.
	 */
	on(listener: (event: ConversationEvent) => void): Disposable;
}
