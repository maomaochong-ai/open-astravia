import type { ChatErrorKind } from "@domains/chat/services/classifyChatError";
import type { ContextCompositionReport, PromptAttachmentRef, PromptResourceRef } from "@vetta/runtime-core";
import type { CardDescriptor } from "@vetta-org/plugin-sdk";
import { atom } from "jotai";
import { runningSessionPathsAtom } from "./running-sessions-atoms";

// ─── Rich content blocks ───

export interface TextBlock {
	type: "text";
	/** Stable id for React keying — survives reorder of surrounding blocks. */
	id: string;
	text: string;
}

export interface ThinkingBlock {
	type: "thinking";
	/** Stable id for React keying. */
	id: string;
	text: string;
}

export interface ToolPhaseInfo {
	label: string;
	atMs: number;
}

export interface ToolImagePreview {
	data: string;
	mimeType: string;
	originalPath?: string;
	originalMimeType?: string;
	originalSizeBytes?: number;
	originalWidth?: number;
	originalHeight?: number;
	processedSizeBytes?: number;
	processedWidth?: number;
	processedHeight?: number;
	wasResized?: boolean;
}

export interface ToolCallUiDetails {
	/** Unified diff for UI rendering only. Never sent back to the model. */
	diff?: string;
	/** First changed line in the new file, for compact path display. */
	firstChangedLine?: number;
	/** ask_user_question 的用户作答结果，供 transcript 富视图回显（不回传模型）。 */
	askUserQuestion?: AskUserQuestionResolution;
	/** 知识库工具（kb_*）的结构化结果，供富视图渲染（不回传模型）。 */
	knowledge?: KnowledgeToolUiDetails;
}

/** 知识库工具结果的 UI 结构（来自工具的 details）。 */
export type KnowledgeToolUiDetails =
	| {
			kind: "filter";
			count: number;
			pages: Array<{ id: string; absolutePath: string; title: string; summary: string; tags: string[] }>;
	  }
	| { kind: "tags"; tags: Array<{ tag: string; count: number }> }
	| { kind: "write"; action: string; id: string; absolutePath: string; movedFrom?: string };

/** ask_user_question：单个选项。 */
export interface QuestionOption {
	label: string;
	description: string;
	badges?: string[];
}

/** ask_user_question：单个问题（问题组成员）。 */
export interface QuestionItem {
	question: string;
	header: string;
	options: QuestionOption[];
	multiSelect?: boolean;
}

/** ask_user_question：一次提问的用户作答（每题选中的标签 / 自由文本）。 */
export interface QuestionAnswer {
	question: string;
	answers: string[];
}

/** ask_user_question：作答结果（取消 or 各题答案）。 */
export interface AskUserQuestionResolution {
	cancelled: boolean;
	answers: QuestionAnswer[];
}

/** 一次待答的 ask_user_question 请求，绑定到发起它的 session。 */
export interface PendingQuestion {
	requestId: string;
	sessionId: string;
	questions: QuestionItem[];
}

export interface ToolCallBlock {
	type: "tool_call";
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	/** "pending" = waiting for result, "success" = completed, "error" = failed */
	status: "pending" | "success" | "error";
	result?: string;
	imagePreview?: ToolImagePreview;
	uiDetails?: ToolCallUiDetails;
	/**
	 * Settled card descriptors this tool produced (from the result's out-of-band
	 * `details.cards`). The per-message card host resolves each by `type` to a
	 * plugin card renderer. Never sent to the LLM.
	 */
	cards?: CardDescriptor[];
	isError?: boolean;
	/**
	 * Out-of-band timing metadata. Never sent to LLMs.
	 * - startedAt: absolute ms when execution began (from tool.start event)
	 * - durationMs: total execution time (from tool.end event or ToolTimingEntry)
	 * - phases: tool-reported phase boundaries; each phase ends when the next
	 *   one starts (or when execution ends)
	 * - currentPhase: only set while status === "pending" — the most recent
	 *   tool.phase event's label, for live display.
	 */
	startedAt?: number;
	durationMs?: number;
	phases?: ToolPhaseInfo[];
	currentPhase?: string;
}

export interface ToolResultBlock {
	type: "tool_result";
	toolCallId: string;
	toolName: string;
	content: string;
	isError: boolean;
}

export interface ErrorBlock {
	type: "error";
	/** Stable id for React keying. */
	id: string;
	/** Provider / 网关的原始错误串，只在错误卡的折叠区展示。 */
	text: string;
	/**
	 * 归类结果，写入时由 classifyChatError 计算（live 与历史回放共用），决定
	 * 卡片的图标、文案与是否给跳转按钮。
	 */
	kind: ChatErrorKind;
	/** 发出这条错误前自动重试过的次数；0 或缺省表示没重试过。 */
	attempts?: number;
	/**
	 * 历史回放时被折叠进来的同类错误条数（含自身）。>1 时卡片显示「重复 N 次」。
	 * live 链路不会产生 >1 的值——那边靠 attempts 表达。
	 */
	repeated?: number;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolCallBlock | ToolResultBlock | ErrorBlock;

/** Sibling user-message versions under the same parent (session tree). */
export interface ChatMessageBranch {
	/** Session entryIds of sibling user messages, oldest → newest */
	siblings: string[];
	/** Index of this message in siblings */
	index: number;
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "compaction";
	/** Plain text for user messages; for assistant messages this is the concatenated text blocks */
	text: string;
	/**
	 * Session tree entry id (coding-agent). Present for history-backed messages;
	 * optimistic bubbles may omit until history reload.
	 */
	entryId?: string;
	/** Session parent entry id (null for root). */
	parentId?: string | null;
	/** User-message sibling branch info for ‹ i/n › switcher. */
	branch?: ChatMessageBranch;
	/** Rich content blocks for assistant messages */
	blocks?: ContentBlock[];
	/** Attached images for user messages */
	images?: Array<{ data: string; mimeType: string; name: string }>;
	/** Timestamp when the message was created (Date.now()) */
	timestamp?: number;
	/** Timestamp when this assistant turn started (agent_start) */
	startedAt?: number;
	/** Timestamp when this assistant turn ended (agent_end/aborted) */
	endedAt?: number;
	/** Total duration of this assistant turn in seconds (agent_start → agent_end) */
	durationSeconds?: number;
	/** 该 user turn 实际使用的模型，用于 MessageList 派生"切换了模型"分隔条 */
	model?: { provider: string; id: string };
	/** Appshot 全局手势捕获的前台窗口附件（乐观气泡携带，供消息里特殊渲染） */
	appshot?: AppshotAttachment;
	/** 用户通过 @ 面板手动选择的文件（仅面板选择，不含手打 @/path 文本） */
	mentionedFiles?: MentionedFile[];
	/**
	 * 来自设置页「让 AI 协助配置」的 tab id（如 mcp / models），气泡展示「MCP配置协助」等标签。
	 * 乐观发送与历史回放（settings_assist_marker）都会设置。
	 */
	settingsAssistTabId?: string;
	/** Structured Skill / Scene selection associated with this user turn. */
	promptRef?: PromptResourceRef;
	/** Structured filesystem attachments associated with this user turn. */
	attachments?: PromptAttachmentRef[];
}

/**
 * Pending replacement of the latest user message. The destructive backend change
 * runs on send (not on click), so cancelling the edit has no session side effects.
 */
export interface PendingMessageEdit {
	entryId: string;
}

export interface ActiveSession {
	cwd: string;
	sessionPath: string;
	runtimeId: string;
	/** Parent session jsonl path when this session was forked. */
	parentSessionPath?: string;
	/** User entry id in the parent session this fork was created from. */
	parentEntryId?: string;
}

/** After opening a parent session from a fork banner, scroll to this entry. */
export interface PendingScrollToEntry {
	entryId: string;
}

export const pendingScrollToEntryAtom = atom<PendingScrollToEntry | null>(null);

export interface LastActiveSession {
	cwd: string;
	sessionPath: string;
}

export type SessionExecutionMode = "sandbox" | "full-access";
export type ExecutionModeOverride = "inherit" | SessionExecutionMode;

// ─── Attached images ───

export interface AttachedImage {
	/** Unique ID for React key */
	id: string;
	/** Base64-encoded image data (no data URI prefix) */
	data: string;
	/** MIME type, e.g. "image/png" */
	mimeType: string;
	/** Display name (file name or "Pasted image") */
	name: string;
}

// ─── Appshot attachment ───

/** Appshot 全局手势捕获的前台窗口附件（v1 单附件，新捕获覆盖旧的）。 */
export interface AppshotAttachment {
	id: string;
	appName: string;
	windowTitle: string;
	documentPath: string | null;
	imagePath: string | null;
	iconPath: string | null;
	textPath: string | null;
	capturedAt: number;
}

export const appshotAttachmentAtom = atom<AppshotAttachment | null>(null);

/** 聚焦输入框请求计数器：bump 后 InputBar 的 effect focus textarea。 */
export const focusInputRequestAtom = atom(0);

// ─── Usage tracking ───

export interface TurnUsageData {
	/** Output speed: tokens per second */
	outputSpeed: number;
	/** Duration of this turn in seconds */
	durationSeconds: number;
}

export interface ContextUsageData {
	/** Context usage percentage (0-100), or null if unknown */
	percent: number | null;
	/** Context window size in tokens */
	contextWindow: number;
	/** Latest privacy-safe model-call composition report. */
	composition?: ContextCompositionReport;
}

// ─── Slash panel (skill/scene selection) ───

export interface SelectedSkill {
	name: string;
	alias?: string;
	type: "skill" | "scene";
}

// ─── Mentioned files (@file selection) ───

export interface MentionedFile {
	/** Absolute path */
	path: string;
	/** Display name (file or dir name) */
	name: string;
	isDirectory: boolean;
	sizeBytes?: number;
}

export const chatMessagesAtom = atom<ChatMessage[]>([]);

/** Pending latest-message replacement, deferred until send. */
export const pendingMessageEditAtom = atom<PendingMessageEdit | null>(null);

export const inputValueAtom = atom<string>("");
export const attachedImagesAtom = atom<AttachedImage[]>([]);
export const activeSessionAtom = atom<ActiveSession | null>(null);

const LAST_ACTIVE_SESSION_STORAGE_KEY = "vetta-last-active-session";

function readLastActiveSession(): LastActiveSession | null {
	try {
		const raw = localStorage.getItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
		if (!raw) return null;
		const value = JSON.parse(raw) as Partial<LastActiveSession>;
		if (typeof value.cwd !== "string" || !value.cwd || typeof value.sessionPath !== "string" || !value.sessionPath) {
			localStorage.removeItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
			return null;
		}
		return { cwd: value.cwd, sessionPath: value.sessionPath };
	} catch {
		localStorage.removeItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
		return null;
	}
}

const lastActiveSessionStorageAtom = atom<LastActiveSession | null>(readLastActiveSession());

/**
 * 可跨 renderer 刷新恢复的会话定位信息。
 * runtimeId 仅在当前进程有效，因此这里只持久化可交给 session.create 重新打开的 cwd + sessionPath。
 */
export const lastActiveSessionAtom = atom(
	(get) => get(lastActiveSessionStorageAtom),
	(_get, set, value: LastActiveSession | null) => {
		set(lastActiveSessionStorageAtom, value);
		if (value) {
			localStorage.setItem(LAST_ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(value));
		} else {
			localStorage.removeItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
		}
	},
);

/**
 * 「当前 active session 正在 streaming」的本地直读信号。
 *
 * 由 useSessionManager 的 IPC subscribe 在收到 agent_start/agent_end 时写入。
 * 它能 cover 一个场景：brand-new session 创建后第一次 streaming —— 此时
 * activeSession.sessionPath 可能还没解析完，runningSessionPathsAtom 也尚未
 * 同步到当前会话，但 in-renderer subscribe 已经能直接听到 agent_start。
 *
 * 切走会话再切回的丢失场景由 runningSessionPathsAtom 兜底（main 进程全局广播，
 * 不依赖单一 subscribe 的存活）。两路 OR 起来即可。
 */
export const activeSessionStreamingAtom = atom<boolean>(false);

/**
 * 当前 active session 是否处于 streaming（agent_start..agent_end）。
 * = 本地信号 OR (runningSessionPathsAtom 中存在当前 sessionPath)
 */
export const isStreamingAtom = atom<boolean>((get) => {
	// 没有 activeSession 时一律视为非 streaming，避免上一个会话残留的
	// activeSessionStreamingAtom=true 信号污染 NewSessionPage 等无会话场景。
	const active = get(activeSessionAtom);
	if (!active) return false;
	if (get(activeSessionStreamingAtom)) return true;
	if (!active.sessionPath) return false;
	return get(runningSessionPathsAtom).has(active.sessionPath);
});
function getStoredExecutionMode(): SessionExecutionMode {
	return localStorage.getItem("vetta-session-execution-mode") === "sandbox" ? "sandbox" : "full-access";
}

export const sessionExecutionModeAtom = atom<SessionExecutionMode>(getStoredExecutionMode());

/**
 * 当前工作模式（agent_mode 轴，纯全局态，见 ADR-0046）。真源在主进程 desktop-config，
 * 本 atom 于 app 初始化时由 config.get() 水合、并跟随主进程广播更新。默认 "work"。
 */
export type AgentMode = "work" | "coding";
export const agentModeAtom = atom<AgentMode>("work");

/** Per-turn stats (speed, duration) for the last completed turn */
export const lastTurnUsageAtom = atom<TurnUsageData | null>(null);

/** Current context window usage */
export const contextUsageAtom = atom<ContextUsageData | null>(null);

/** Whether context compaction is currently in progress */
export const isCompactingAtom = atom<boolean>(false);

/** 自动重试退避中的进度；null = 没在重试。由 retry.start / retry.end 驱动。 */
export interface RetryProgress {
	attempt: number;
	maxAttempts: number;
}
export const retryProgressAtom = atom<RetryProgress | null>(null);

/** 当前 session 是否正在懒重载 MCP 配置（用户发 prompt 后 ~1-3s）。
 * 仅由 mcp.reload.start/end 驱动；UI 用一条非阻塞的小提示告知用户。 */
export const isReloadingMcpAtom = atom<boolean>(false);

/**
 * 待答的 ask_user_question 请求，按发起 session 的 runtimeId 索引。
 * InputBar 据此把对应 session 的输入栏接管为「问答面板」；切换 session 只是隐藏，
 * 切回恢复（该 session 的 agent 仍阻塞等回答）。提交/取消后由面板删除对应项。
 */
export const pendingQuestionsAtom = atom<Record<string, PendingQuestion>>({});

/**
 * 输入预测建议，按发起会话的 runtimeId 索引（仿 pendingQuestionsAtom 的 Record 形态）。
 * agent 一轮正常完成后异步生成 0-3 条；该会话发出下一个 prompt 即清空。切会话只是
 * 隐藏、切回恢复；纯内存态，不持久化。首条同时作为 InputBar placeholder。
 */
export const promptSuggestionsAtom = atom<Record<string, string[]>>({});

/**
 * 输入预测「生成中」状态，按会话 runtimeId 索引。生成调用在飞时为 true，
 * 用于在该会话末条 assistant 消息的操作栏右侧显示「Vetta 正在预测…」闪光提示。
 */
export const promptPredictingAtom = atom<Record<string, boolean>>({});

/** 新会话全局模型偏好（localStorage）；已有会话仍以 session settings 为准 pull 覆盖。 */
export const SELECTED_MODEL_STORAGE_KEY = "vetta-selected-model";

/**
 * 当前选中模型，格式 "provider/modelId"。
 * - 新会话 / 欢迎页：从 localStorage 的全局偏好恢复，用户切换时写回。
 * - 打开已有会话：由后端 session settings pull 覆盖为该会话模型。
 */
export const selectedModelAtom = atom<string | null>(
	typeof localStorage !== "undefined" ? localStorage.getItem(SELECTED_MODEL_STORAGE_KEY) : null,
);

/**
 * Per-model reasoning level memory: maps modelKey ("provider/modelId") → chosen level value.
 * Persisted to localStorage so each model remembers its last-chosen level across sessions/restart.
 */
const REASONING_BY_MODEL_KEY = "vetta-reasoning-by-model";
function loadReasoningByModel(): Record<string, string> {
	try {
		const raw = localStorage.getItem(REASONING_BY_MODEL_KEY);
		return raw ? (JSON.parse(raw) as Record<string, string>) : {};
	} catch {
		return {};
	}
}
const reasoningByModelBaseAtom = atom<Record<string, string>>(loadReasoningByModel());
export const reasoningByModelAtom = atom(
	(get) => get(reasoningByModelBaseAtom),
	(_get, set, next: Record<string, string>) => {
		set(reasoningByModelBaseAtom, next);
		try {
			localStorage.setItem(REASONING_BY_MODEL_KEY, JSON.stringify(next));
		} catch {
			// ignore persistence errors (private mode / quota)
		}
	},
);

/** Whether the current session model supports image input */
export const modelSupportsImagesAtom = atom<boolean>(true);

export const selectedSkillAtom = atom<SelectedSkill | null>(null);
export const mentionedFilesAtom = atom<MentionedFile[]>([]);

// ─── Action button bar ───

export interface ActionButtonDef {
	/** Unique identifier */
	id: string;
	/** Display label */
	label: string;
	/** MDI icon class name, e.g. "icon-[mdi--swap-horizontal]" */
	icon?: string;
	/** Sort weight — lower values appear first (default 0) */
	order?: number;
}

/** Registered button definitions */
export const actionButtonDefsAtom = atom<ActionButtonDef[]>([]);

/** Set of hidden button ids for visibility control */
export const hiddenActionButtonsAtom = atom<Set<string>>(new Set<string>());

/** Derived: visible buttons sorted by order */
export const visibleActionButtonsAtom = atom((get) => {
	const defs = get(actionButtonDefsAtom);
	const hidden = get(hiddenActionButtonsAtom);
	return defs.filter((d) => !hidden.has(d.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
});

/** Registry mapping button id → click handler */
export const actionButtonHandlersAtom = atom<Map<string, () => void>>(new Map());

/** Options for {@link openSessionFnRef} / useSessionManager.openSession. */
export interface OpenSessionOptions {
	/**
	 * When false, create/subscribe the session and set it active, but stay on the
	 * current route (e.g. Settings AI assist fly-to-sidebar). Default true.
	 */
	navigate?: boolean;
}

/** Global callback to open a session (set by useSessionManager, consumed by other pages) */
// Use a module-level ref instead of atom to avoid structured clone issues with functions
export const openSessionFnRef: {
	current:
		| ((
				cwd: string,
				sessionPath?: string,
				executionMode?: SessionExecutionMode,
				options?: OpenSessionOptions,
		  ) => Promise<void>)
		| null;
} = {
	current: null,
};

/** Optional per-send options for {@link sendMessageFnRef} / useSessionManager.sendMessage. */
export interface SendMessageOptions {
	/**
	 * Merged into PromptRequest.metadata (host-side / input-pipeline only; not shown as
	 * user bubble text). e.g. settingsAssistInstruction for model-only settings assist.
	 */
	metadata?: Record<string, unknown>;
	/** Settings page tab id for the optimistic bubble badge (e.g. "mcp" →「MCP配置协助」). */
	settingsAssistTabId?: string;
	/** 插件 sendPrompt 路径：不清用户输入预测、不消费用户挂的 promptAttachment（ADR-0060）。 */
	source?: "plugin";
}

/** sendMessage 的回执（ADR-0060）：streaming 中入 kernel 队列时返回 queued + 条目 id。 */
export interface SendMessageResult {
	status: "sent" | "queued";
	queueItemId?: string;
}

/**
 * Global send path (set by useSessionManager). Prefer after openSession in the same tick —
 * openSession writes activeSessionRef so overrideText can go out immediately.
 */
export const sendMessageFnRef: {
	current: ((overrideText?: string, options?: SendMessageOptions) => Promise<SendMessageResult | undefined>) | null;
} = {
	current: null,
};
