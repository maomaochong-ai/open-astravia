import type { Message } from "@vetta/ai";
import type {
	HistoryEntry,
	ProjectInfo,
	PromptRequest,
	RuntimeSandboxGrantDecision,
	RuntimeSandboxGrantInfo,
	RuntimeSandboxGrantRequest,
	RuntimeSessionQueueStateView,
	RuntimeTurnPromptOutcome,
	RuntimeUserConfirmationRequest,
	RuntimeUserQuestionRequest,
	RuntimeUserQuestionResult,
	SessionConfig,
	SessionEvent,
	SessionExecutionMode,
	SessionStateSnapshot,
	SettingsPatch,
} from "@vetta/runtime-core";
import type { DesktopSessionHistoryInfo } from "../../shared/session-access.js";

/** 工作模式（agent_mode 轴，见 ADR-0046）。 */
export type AgentMode = "work" | "coding";

/** 个性化人设选项（由 coding-agent 注册表下发，不含提示词正文）。 */
export interface PersonaOption {
	id: string;
	label: string;
	description: string;
}

/** 个性化配置：选中的人设 id + 自定义指令文本。 */
export interface PersonalizationConfig {
	personaId: string;
	customPrompt: string;
}

export type DesktopSessionKind = "conversation" | "other";

export type DesktopUserQuestionRequest = RuntimeUserQuestionRequest;

export interface DesktopUserQuestionResolvedEvent {
	requestId: string;
	sessionId: string;
}

export interface DesktopSessionApi {
	create(
		config: SessionConfig | undefined,
		kind: DesktopSessionKind,
	): Promise<{ sessionId: string; sessionPath: string; cwd?: string }>;
	listProjects(): Promise<ProjectInfo[]>;
	listSessions(cwd: string): Promise<DesktopSessionHistoryInfo[]>;
	onSessionsChanged(
		handler: (payload: {
			cwd: string;
			sessionPath: string;
			session?: { id: string; cwd: string; firstMessage: string; modifiedAt: number };
		}) => void,
	): () => void;
	/** 回执（ADR-0060）：streaming 中带 streamingBehavior 的请求入 kernel 队列并立即返回 queued。 */
	prompt(sessionId: string, request: PromptRequest): Promise<RuntimeTurnPromptOutcome>;
	continue(sessionId: string): Promise<void>;
	abort(sessionId: string): Promise<void>;
	/** kernel 输入队列快照（ADR-0060）。 */
	getQueueState(sessionId: string): Promise<RuntimeSessionQueueStateView>;
	removeQueuedMessage(sessionId: string, itemId: string): Promise<boolean>;
	reorderQueuedMessages(sessionId: string, itemIds: string[]): Promise<void>;
	/** streaming 中打断当前回合并立刻以该条目开新回合；空闲时直接开新回合。不等待回合结束。 */
	sendQueuedMessageNow(sessionId: string, itemId: string): Promise<"promoted" | "started" | "missing">;
	/** 解除 abort/error 后的队列暂停并继续逐条发送。 */
	resumeQueue(sessionId: string): Promise<void>;
	clearQueue(sessionId: string): Promise<void>;
	/** 清空 session 的 todo 列表（被 scene 等 lock 时返回 false）。 */
	clearTodos(sessionId: string): Promise<boolean>;
	subscribe(sessionId: string, handler: (event: SessionEvent) => void): Promise<() => void>;
	onConfirmationRequest(handler: (request: RuntimeUserConfirmationRequest) => void): () => void;
	respondToConfirmation(requestId: string, confirmed: boolean): Promise<void>;
	/** ask_user_question：监听主进程发来的提问请求（携 sessionId + questions）。 */
	onQuestionRequest(handler: (request: RuntimeUserQuestionRequest) => void): () => void;
	/** 当前仍等待回答的问题快照，供 Renderer 初始化或重载后恢复真实状态。 */
	listPendingQuestions(): Promise<RuntimeUserQuestionRequest[]>;
	/** 问题由用户、Agent、取消或中断解决后统一通知 Renderer 清理面板。 */
	onQuestionResolved(handler: (event: DesktopUserQuestionResolvedEvent) => void): () => void;
	/** 回传用户对某次提问的答案 / 取消。 */
	respondToQuestion(requestId: string, result: RuntimeUserQuestionResult): Promise<void>;
	onSandboxGrantRequest(handler: (request: RuntimeSandboxGrantRequest) => void): () => void;
	respondToSandboxGrant(requestId: string, decision: RuntimeSandboxGrantDecision): Promise<void>;
	listSandboxGrants(sessionId: string): Promise<RuntimeSandboxGrantInfo[]>;
	revokeSandboxGrant(sessionId: string, grantId: string): Promise<boolean>;
	revokeAllSandboxGrants(sessionId: string): Promise<number>;
	/** 清除指定 session 中所有已结束的后台任务，返回清除数量。 */
	clearFinishedBackgroundTasks(sessionId: string): Promise<number>;
	/** 用户从 UI 手动终止运行中的后台任务；成功后 agent 会收到 task-notification。 */
	killBackgroundTask(sessionId: string, taskId: string): Promise<boolean>;
	/** 中断运行中的子代理（explorer 等）。 */
	interruptSubagent(sessionId: string, target: string): Promise<boolean>;
	getSessionPath(sessionId: string): Promise<string | undefined>;
	updateSettings(sessionId: string, partialSettings: SettingsPatch): Promise<void>;
	setExecutionMode(sessionId: string, mode: SessionExecutionMode): Promise<void>;
	setGlobalExecutionMode(mode: SessionExecutionMode): Promise<void>;
	/** 全局切换工作模式（agent_mode 轴，纯全局态）。见 ADR-0046。 */
	setGlobalAgentMode(mode: AgentMode): Promise<void>;
	/** 订阅工作模式变更广播（多窗口同步 badge/atom）。 */
	onAgentModeChanged(handler: (mode: AgentMode) => void): () => void;
	setGlobalThinkingLevel(level: string): Promise<void>;
	getGlobalThinkingLevel(): Promise<string>;
	getPersonas(): Promise<PersonaOption[]>;
	getPersonalization(): Promise<PersonalizationConfig>;
	setPersonalization(input: PersonalizationConfig): Promise<void>;
	getState(sessionId: string): Promise<SessionStateSnapshot>;
	getMessages(sessionId: string): Promise<Message[]>;
	getFullHistory(sessionId: string): Promise<HistoryEntry[]>;
	/** Prepare re-edit: set leaf to parent of user entry; returns text. Call before prompt. */
	navigateForEdit(sessionId: string, entryId: string): Promise<{ text: string; cancelled: boolean }>;
	/** Switch leaf to tip of subtree at entryId (sibling branch view). */
	switchBranch(sessionId: string, entryId: string): Promise<{ leafId: string }>;
	/** Permanently delete one message while preserving subsequent messages. */
	deleteMessage(sessionId: string, entryId: string): Promise<{ leafId: string | null }>;
	/** Remove the last user turn before sending its edited replacement. */
	replaceLastUserMessage(sessionId: string, entryId: string): Promise<{ leafId: string | null }>;
	/** Export fork as new session file; current session unchanged. */
	forkSession(sessionId: string, entryId: string): Promise<{ path: string; text: string }>;
	delete(sessionPath: string): Promise<void>;
	rename(sessionPath: string, name: string): Promise<void>;
	autoTitle(sessionId: string, userText: string, assistantText: string): Promise<string | null>;
	/**
	 * 输入预测：基于最近几轮对话文本，预测用户下一个可能输入的 prompt，返回 0-3 条
	 * 建议。模型/key 不可用、出错或对话已收尾时返回空数组。
	 */
	nextPromptSuggestions(sessionId: string, conversation: string): Promise<string[]>;
	dispose(sessionId: string): Promise<void>;
	/** Snapshot of session paths currently in the agent loop. */
	listRunning(): Promise<string[]>;
	/**
	 * 当前有会话在跑的项目 cwd（去重）。会话文件路径无法反推所属项目（默认落在
	 * 按 cwd 编码的分片目录里，编码不可逆），需要项目粒度的运行态时用这个。
	 */
	listRunningCwds(): Promise<string[]>;
	/** Subscribe to running-set changes. Fires for each toggle (running=true|false). */
	onRunningChanged(
		handler: (payload: {
			sessionPath: string;
			running: boolean;
			sessionId?: string;
			reason?: "agent_end" | "aborted" | "error";
		}) => void,
	): () => void;
	/**
	 * 清空默认「对话」或 Claw 项目的全部会话（保留产物），按 scope 分流（物理 cwd 分家，ADR-0005）：
	 * - "conversation"：清桌面「对话」cwd 的 .vetta/sessions
	 * - "claw"：清 IM cwd 的 .vetta/sessions
	 * 主进程会先 dispose 本 scope 涉及的 session handle；若该 scope 仍有运行中的会话则抛错拒绝。
	 */
	clearDefaultConversation(scope: "conversation" | "claw"): Promise<void>;
	/**
	 * 清空默认「对话」或 Claw 项目 cwd 下的产物文件（保留 .vetta 目录，会话不受影响）。
	 */
	clearDefaultArtifacts(scope: "conversation" | "claw"): Promise<void>;
	/**
	 * Open a session for read-only viewing. Does NOT acquire the
	 * session-file lock, so IM-owned sessions (sidecar may be actively
	 * writing) can be viewed live without conflict.
	 */
	openViewer(path: string): Promise<{ history: HistoryEntry[] }>;
	/**
	 * Subscribe to live updates for a viewer-mode session. Handler fires
	 * whenever the underlying .jsonl is written. Returns an unsubscribe
	 * function — caller MUST call it on unmount to release the fs.watch.
	 */
	subscribeViewer(path: string, handler: (snapshot: { history: HistoryEntry[] }) => void): Promise<() => void>;
}
