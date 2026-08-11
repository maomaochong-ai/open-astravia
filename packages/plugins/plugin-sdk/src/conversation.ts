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
	/**
	 * 模型还在生成这次调用，流式参数已解析出新的键。
	 *
	 * 用它做「agent 正在动某个目标」这类实时 UI：`edit` / `write` 真正耗时的是
	 * 生成参数（一整份文件正文），执行只要几毫秒，等 `tool-call-start` 到手时活
	 * 已经干完了。目标路径通常是参数里的第一个键，所以能提前几秒拿到。
	 *
	 * 天然是残缺的：后面的键还没到，正在生成的那个键也不含在内。要权威全量参数
	 * 请用 `tool-call-start`。同一次调用会随键数增长发多次，不会逐 token 发。
	 */
	| { type: "tool-call-args"; toolCallId: string; toolName: string; args: Record<string, unknown> }
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

/** createSession 的可选项。 */
export interface CreateSessionOptions {
	/**
	 * false 时会话照常创建并设为活跃，但宿主停留在当前路由（后台任务用）。
	 * 默认 true：与用户在新会话页手动发送的观感一致，发出去就进对话页。
	 */
	navigate?: boolean;
}

export interface PluginConversationApi {
	/**
	 * Send a prompt into the active conversation (renders as a user turn).
	 * Streaming 中会进入会话队列并立即 resolve `{ status: "queued" }`；
	 * 队列在本轮自然停止点接力消费，abort/error 后暂停待用户处置。
	 *
	 * 没有活跃会话时抛错。插件若想在这种情况下也把话说出去，先 {@link createSession}。
	 */
	sendPrompt(text: string): Promise<SendPromptResult>;
	/**
	 * Create a conversation in `cwd` and make it active, resolving once it is ready
	 * to receive prompts — `await createSession(cwd)` 后可以直接 {@link sendPrompt}。
	 *
	 * 用于宿主此刻没有活跃会话的场景（例如用户停在新会话页，插件侧却已经产生了要
	 * 交给 agent 的工作）。已有活跃会话时照样新建一个，不做复用判断——要不要新开由
	 * 插件按自己的语义决定。
	 *
	 * 执行模式跟随宿主当前选择，插件不感知。
	 */
	createSession(cwd: string, options?: CreateSessionOptions): Promise<ConversationState>;
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
