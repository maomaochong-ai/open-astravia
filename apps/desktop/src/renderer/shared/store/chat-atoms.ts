import type { DesktopMcpElicitationRequest } from "@preload/api";
import type {
	AppshotAttachment,
	ChatErrorDetails,
	ConversationTimelineItemViewModel,
	ConversationUserMessageViewModel,
	MentionedFile,
	PendingQuestion,
} from "@shared/conversation";
import type { ContextCompositionReport } from "@vetta/runtime-core";
import { atom } from "jotai";
import { runningSessionPathsAtom } from "./running-sessions-atoms";

export type ChatTimelineEventViewModel = { readonly kind: "compaction"; readonly summary: string };
export type ChatConversationItem = ConversationTimelineItemViewModel<ChatTimelineEventViewModel>;

export type {
	AskUserQuestionResolution,
	ChatErrorDetails,
	ContentBlock,
	ErrorBlock,
	KnowledgeToolUiDetails,
	PendingQuestion,
	QuestionAnswer,
	QuestionItem,
	QuestionOption,
	TextBlock,
	ThinkingBlock,
	ToolAudioPreview,
	ToolCallBlock,
	ToolCallUiDetails,
	ToolImagePreview,
	ToolPhaseInfo,
	ToolResultBlock,
} from "@shared/conversation";

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

/**
 * Renderer-only state while a brand-new session is being created. It keeps the
 * chat route renderable before a runtimeId exists and coordinates deferred work.
 * It must not be used as a presentation or interaction-disabled signal.
 */
export interface PendingSessionCreation {
	cwd: string;
	interactionId: string;
}

/**
 * Renderer-only transition state while an existing Session runtime is restored.
 * The target path is available before runtimeId, so the sidebar, draft scope and
 * Viewer history can switch immediately. Runtime-bound work waits internally for
 * this exact transition; UI controls remain available.
 */
export interface PendingSessionOpen {
	cwd: string;
	sessionPath: string;
	interactionId: string;
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
	/** Provider-reported context tokens; absent/null while only an estimate is available. */
	contextTokens?: number | null;
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

export type { AppshotAttachment, MentionedFile } from "@shared/conversation";

export const chatMessagesAtom = atom<ChatConversationItem[]>([]);

/** Pending latest-message replacement, deferred until send. */
export const pendingMessageEditAtom = atom<PendingMessageEdit | null>(null);

export const inputValueAtom = atom<string>("");
export const attachedImagesAtom = atom<AttachedImage[]>([]);
export const activeSessionAtom = atom<ActiveSession | null>(null);
export const pendingSessionCreationAtom = atom<PendingSessionCreation | null>(null);
export const pendingSessionOpenAtom = atom<PendingSessionOpen | null>(null);

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
 * 新会话的默认工作模式（agent_mode 轴）。真源在主进程 desktop-config 的
 * defaultAgentMode，本 atom 于新会话页读取时由 config.get() 水合、并跟随主进程广播更新。
 *
 * 注意语义：这里只是「下一个新会话用哪个模式」。会话的模式在创建时固化、会话内不可变，
 * 改这个值不会影响任何已存在的会话。
 */
export type AgentMode = string;
/** 出厂默认模式：atom 水合前的初始值，也是模式 toggle 的显示排序锚点（默认模式排最前）。 */
export const FACTORY_DEFAULT_AGENT_MODE: AgentMode = "work";
export const defaultAgentModeAtom = atom<AgentMode>(FACTORY_DEFAULT_AGENT_MODE);

/**
 * 当前打开会话的工作模式，来自 SessionStateSnapshot.agentMode（会话创建时固化）。
 * 与 defaultAgentModeAtom 的区别：这个是「本会话是什么」，那个是「下一个新会话用什么」。
 * 凡是按会话渲染的地方（如回答分组样式）都必须读这个，否则改默认值会串改已打开的会话。
 * null = 会话未打开或未指定模式。
 */
export const sessionAgentModeAtom = atom<AgentMode | null>(null);

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
	/** 上一次失败的原始原因；UI 只展示归类后的人话，最终失败卡仍可展开原文。 */
	errorMessage: string;
	details?: ChatErrorDetails;
}
export const retryProgressAtom = atom<RetryProgress | null>(null);

/** 当前 session 是否正在懒重载 MCP 配置（用户发 prompt 后 ~1-3s）。
 * 仅由 Coding Agent MCP 扩展观察驱动；UI 用一条非阻塞的小提示告知用户。 */
export const isReloadingMcpAtom = atom<boolean>(false);

/**
 * 待答的 ask_user_question 请求，按发起 session 的 runtimeId 索引。
 * InputBar 据此把对应 session 的输入栏接管为「问答面板」；切换 session 只是隐藏，
 * 切回恢复（该 session 的 agent 仍阻塞等回答）。提交/取消后由面板删除对应项。
 */
export const pendingQuestionsAtom = atom<Record<string, PendingQuestion>>({});
export const pendingMcpElicitationsAtom = atom<Record<string, DesktopMcpElicitationRequest>>({});

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
	/** Correlates Renderer interaction timing with the Main-process creation trace. */
	interactionId?: string;
	/**
	 * Runs once the event subscription is live, before nonessential Session hydration
	 * finishes. Dispatched, never awaited: the first prompt's IPC only settles when the
	 * whole turn ends, so awaiting it would hold Session hydration for the turn.
	 */
	onPromptReady?: () => void | Promise<void>;
	/**
	 * For a new session, render the chat route and yield a paint before starting
	 * runtime creation. Existing-session opens ignore this option.
	 */
	navigateBeforeCreate?: boolean;
	/** Keep a caller-staged optimistic message instead of clearing the message list. */
	preserveMessagesBeforeCreate?: boolean;
	/** Lets a staged new-session send restore its input snapshot if creation fails. */
	onCreateError?: (error: unknown) => void;
}

/** Immutable input captured before a new session has a runtimeId. */
export interface StagedSendInput {
	/** Draft scope that owned the input when the user submitted it. */
	draftKey: string | null;
	rawText: string;
	hasOverride: boolean;
	attachedImages: AttachedImage[];
	mentionedFiles: MentionedFile[];
	appshot: AppshotAttachment | null;
	selectedModel: string | null;
	optimisticMessage: ConversationUserMessageViewModel;
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
	/** Diagnostic correlation only; never merged into Prompt metadata or model context. */
	interactionId?: string;
	/**
	 * Merged into PromptRequest.metadata (host-side / input-pipeline only; not shown as
	 * user bubble text). e.g. settingsAssistInstruction for model-only settings assist.
	 */
	metadata?: Record<string, unknown>;
	/** Settings page tab id for the optimistic bubble badge (e.g. "mcp" →「MCP配置协助」). */
	settingsAssistTabId?: string;
	/** 插件 sendPrompt 路径：不清用户输入预测、不消费用户挂的 promptAttachment（ADR-0060）。 */
	source?: "plugin";
	/** New-session input already rendered optimistically before runtime creation. */
	stagedInput?: StagedSendInput;
}

/** sendMessage 的回执（ADR-0060）：streaming 中入 kernel 队列时返回 queued + 条目 id。 */
export interface SendMessageResult {
	status: "sent" | "queued" | "failed";
	error?: { message: string };
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
