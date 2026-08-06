import type { ThinkingLevel, ToolPhase } from "@vetta/agent-core";
import type { Message, Model } from "@vetta/ai";

/** 对话场景 slug；RuntimeHost 与 Coding Profile 共享的稳定隔离轴。 */
export type ConversationScenario =
	| "im-claw"
	| "conversation"
	| "project"
	| "batch"
	| "automation"
	| "kb-processing"
	| "cli";

export interface PromptResourceRef {
	kind: "skill" | "scene";
	name: string;
}

export interface PromptAttachmentRef {
	kind: "file" | "directory" | "image";
	path: string;
}

export type RuntimeEventSource = "runtime-core" | "agent" | "tool" | "mcp";

export type SystemPromptBlockType =
	| "subconscious"
	| "base"
	| "tools"
	| "mcp"
	| "guidelines"
	| "append"
	| "context"
	| "memory"
	| "skills"
	| "mode"
	| "personalization"
	| "footer"
	| "plugin";

export interface SystemPromptBlock {
	id: string;
	type: SystemPromptBlockType;
	source: {
		kind: "core" | "plugin";
		pluginId?: string;
	};
	content: string;
	priority: number;
	enabled: boolean;
}

export type SystemPromptBlockPatch = Partial<Omit<SystemPromptBlock, "id">>;

export type SystemPromptOperation =
	| { type: "addBlock"; block: SystemPromptBlock }
	| { type: "replaceBlock"; blockId: string; block: SystemPromptBlock }
	| { type: "updateBlock"; blockId: string; patch: SystemPromptBlockPatch }
	| { type: "removeBlock"; blockId: string }
	| { type: "setBlockEnabled"; blockId: string; enabled: boolean };

export interface SystemPromptContribution {
	pluginId: string;
	operations: SystemPromptOperation[];
}

export interface SkillPathContribution {
	pluginId: string;
	paths: string[];
}

export interface ToolPolicyContribution {
	pluginId: string;
	allow?: string[];
	deny?: string[];
}

/**
 * Plugin-scoped MCP server config (structurally aligned with coding-agent
 * `McpServerConfig`). Paths in stdio configs must already be resolved absolute
 * by the host before injection into the runtime.
 */
export type AgentPluginMcpServerConfig =
	| {
			type?: "stdio";
			command: string;
			args?: string[];
			env?: Record<string, string>;
			cwd?: string;
			disabled?: boolean;
			autoApprove?: string[];
			startupTimeout?: number;
			debug?: boolean;
			displayName?: string;
			description?: string;
	  }
	| {
			type: "http";
			url: string;
			headers?: Record<string, string>;
			oauthClientId?: string;
			oauthDeviceFlow?: boolean;
			oauthScopes?: string;
			disabled?: boolean;
			autoApprove?: string[];
			startupTimeout?: number;
			debug?: boolean;
			displayName?: string;
			description?: string;
	  };

/**
 * One MCP server contributed by an installed plugin. `runtimeName` is the
 * globally unique key used by McpManager (must not contain `_` — tool adapter
 * splits on the first underscore after the `mcp_` prefix).
 */
export interface McpServerContribution {
	pluginId: string;
	/** Key inside the plugin's `.mcp.json` / inline map (pre-namespace). */
	localName: string;
	/** Unique runtime server name, e.g. `plugin-cowart-canvas`. */
	runtimeName: string;
	config: AgentPluginMcpServerConfig;
	/** 该 server 的工具允许出现的工作模式 slug（agent_mode 轴，缺省/空 = 通用）。见 ADR-0046。 */
	agent_mode?: string[];
}

export type JsonSchema = Record<string, unknown>;

export interface AgentPluginToolContribution {
	pluginId: string;
	id: string;
	name: string;
	label?: string;
	description: string;
	parameters: JsonSchema;
	handlerId: string;
	timeoutMs?: number;
	/** 允许出现的对话场景 slug（fail-closed：缺省/空 = 所有场景都不激活）。由插件 registerTool 声明。 */
	scope_use?: string[];
	/** 需要的会话能力 slug（如 "knowledge"）。 */
	requires?: string[];
	context?: { conversation?: "summary" | "messages" };
}

export interface AgentPluginStateContribution {
	pluginId: string;
	id: string;
	schema?: JsonSchema;
	initialValue?: unknown;
	persist?: boolean;
}

export interface AgentPluginContinuationContribution {
	pluginId: string;
	id: string;
	handlerId: string;
	timeoutMs?: number;
	context?: { conversation?: "summary" | "messages" };
}

export interface AgentPluginSystemPromptProviderContribution {
	pluginId: string;
	id: string;
	handlerId: string;
	timeoutMs?: number;
	context?: {
		systemPrompt?: "none" | "blocks" | "rendered" | "full";
		conversation?: "summary" | "messages";
	};
}

export interface AgentPluginSystemPromptMessage {
	role: string;
	text: string;
	timestamp?: number;
	toolName?: string;
}

export interface AgentPluginSystemPromptInvocation {
	pluginId: string;
	providerId: string;
	handlerId: string;
	session: { id: string; cwd: string; scenario: string };
	model: {
		provider: string;
		id: string;
		api: string;
		input: string[];
		contextWindow?: number;
		maxTokens?: number;
	};
	conversation: { messages: AgentPluginSystemPromptMessage[]; messageCount: number };
	runtime: { activeToolNames: string[]; availableToolNames: string[]; runIndex: number };
	trigger: { kind: "agent-run"; timestamp: number };
	systemPrompt?: {
		base: { blocks?: SystemPromptBlock[]; rendered?: string };
		current: { blocks?: SystemPromptBlock[]; rendered?: string };
	};
}

export type AgentPluginRuntimeEffect =
	| SystemPromptOperation
	| { type: "setToolEnabled"; toolName: string; enabled: boolean }
	| { type: "requestContinuation"; result: AgentPluginContinuationResult };

export interface AgentPluginHandlerResult<T> {
	value: T;
	effects: AgentPluginRuntimeEffect[];
}

export type AgentPluginSystemPromptInvoker = (
	invocation: AgentPluginSystemPromptInvocation,
	signal?: AbortSignal,
) => Promise<AgentPluginRuntimeEffect[]>;

export interface AgentPluginRuntimeConfig {
	systemPromptContributions?: SystemPromptContribution[];
	skillPathContributions?: SkillPathContribution[];
	toolPolicyContributions?: ToolPolicyContribution[];
	toolContributions?: AgentPluginToolContribution[];
	stateContributions?: AgentPluginStateContribution[];
	continuationContributions?: AgentPluginContinuationContribution[];
	systemPromptProviderContributions?: AgentPluginSystemPromptProviderContribution[];
	/** Plugin-scoped MCP servers (third config source; never written to mcp.json). */
	mcpServerContributions?: McpServerContribution[];
}

export interface AgentPluginToolInvocation {
	pluginId: string;
	toolId: string;
	toolName: string;
	handlerId: string;
	input: unknown;
	session: AgentPluginSystemPromptInvocation["session"];
	model: AgentPluginSystemPromptInvocation["model"];
	conversation: AgentPluginSystemPromptInvocation["conversation"];
	runtime: AgentPluginSystemPromptInvocation["runtime"];
	trigger: { kind: "tool-call"; timestamp: number; toolCallId: string };
}

export type AgentPluginToolInvoker = (
	invocation: AgentPluginToolInvocation,
	signal?: AbortSignal,
) => Promise<AgentPluginHandlerResult<unknown>>;

export interface AgentPluginContinuationInvocation {
	pluginId: string;
	providerId: string;
	handlerId: string;
	session: AgentPluginSystemPromptInvocation["session"];
	model: AgentPluginSystemPromptInvocation["model"];
	conversation: AgentPluginSystemPromptInvocation["conversation"];
	runtime: AgentPluginSystemPromptInvocation["runtime"];
	trigger: { kind: "continuation"; timestamp: number };
}

export interface AgentPluginContinuationResult {
	text: string;
	idempotencyKey?: string;
}

export type AgentPluginContinuationInvoker = (
	invocation: AgentPluginContinuationInvocation,
	signal?: AbortSignal,
) => Promise<AgentPluginHandlerResult<AgentPluginContinuationResult | null>>;

export interface SessionEventBase {
	schemaVersion: 1;
	sessionId: string;
	eventId: string;
	timestamp: number;
	source: RuntimeEventSource;
}

export interface SessionLifecycleEvent extends SessionEventBase {
	type: "session.lifecycle";
	phase: "created" | "agent_start" | "turn_start" | "turn_end" | "agent_end" | "aborted";
}

export interface SessionPathChangedEvent extends SessionEventBase {
	type: "session.path_changed";
	previousSessionId: string;
	previousPath?: string;
	path?: string;
	reason: string;
}

export interface MessageDeltaEvent extends SessionEventBase {
	type: "message.delta";
	delta: string;
}

export interface ThinkingDeltaEvent extends SessionEventBase {
	type: "thinking.delta";
	delta: string;
}

export interface MessageFinalEvent extends SessionEventBase {
	type: "message.final";
	message: Message;
}

export interface ToolCallGeneratingEvent extends SessionEventBase {
	type: "toolcall.start";
	toolCallId: string;
	toolName: string;
}

export interface ToolStartEvent extends SessionEventBase {
	type: "tool.start";
	toolCallId: string;
	toolName: string;
	args: unknown;
	/** Absolute timestamp (ms) when the tool began executing. */
	startedAt: number;
}

export interface ToolUpdateEvent extends SessionEventBase {
	type: "tool.update";
	toolCallId: string;
	toolName: string;
	partialResult: unknown;
}

/**
 * Emitted when a tool reports a phase boundary via ctx.phase(label) during
 * execution. Out-of-band metadata — UI-only, never sent to LLMs.
 */
export interface ToolPhaseEvent extends SessionEventBase {
	type: "tool.phase";
	toolCallId: string;
	toolName: string;
	label: string;
	/** Offset (ms) from the tool's startedAt. */
	atMs: number;
}

export interface ToolEndEvent extends SessionEventBase {
	type: "tool.end";
	toolCallId: string;
	toolName: string;
	isError: boolean;
	result: unknown;
	/** Absolute timestamp (ms) when the tool began executing. */
	startedAt: number;
	/** Total execution duration in milliseconds. */
	durationMs: number;
	/** Phases reported by the tool via ctx.phase(label) — possibly empty. */
	phases: ToolPhase[];
}

export interface McpStatusEvent extends SessionEventBase {
	type: "mcp.status";
	status: "connected" | "degraded" | "disconnected";
	details?: string;
}

/**
 * MCP 懒重载启动：用户提交 prompt 时检测到 mcp.json 变化，开始 diff-reload。
 * UI 可据此显示一个轻提示，不应阻塞用户。
 */
export interface McpReloadStartEvent extends SessionEventBase {
	type: "mcp.reload.start";
}

/**
 * MCP 懒重载结束。changed=false 表示真正的工具集合没变（少见，比如 stop/start
 * 后服务器输出相同 tools），UI 一般什么都不用显示；errorMessage 仅在异常时存在。
 */
export interface McpReloadEndEvent extends SessionEventBase {
	type: "mcp.reload.end";
	changed: boolean;
	errorMessage?: string;
}

export interface UsageUpdateEvent extends SessionEventBase {
	type: "usage.update";
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	costTotal: number;
	/** Context window usage percentage (0-100), or null if unknown (e.g. after compaction) */
	contextPercent: number | null;
	/** Total context window size in tokens */
	contextWindow: number;
}

export interface SessionError {
	code: string;
	message: string;
	retryable: boolean;
	origin: "runtime" | "provider" | "tool" | "mcp";
	details?: unknown;
}

export interface ErrorEvent extends SessionEventBase {
	type: "error";
	error: SessionError;
	/**
	 * 这条错误最终发出前，自动重试实际尝试过的次数（0 = 没重试过）。
	 * 由 session-events 的挂起状态机累计，供 UI 说「已自动重试 N 次仍失败」。
	 */
	retryAttempts?: number;
}

/** 自动重试开始：一次可重试错误后进入退避等待。 */
export interface RetryStartEvent extends SessionEventBase {
	type: "retry.start";
	attempt: number;
	maxAttempts: number;
	delayMs: number;
	errorMessage: string;
}

/** 自动重试结束：success=false 表示重试次数耗尽，随后会有一条 error 事件。 */
export interface RetryEndEvent extends SessionEventBase {
	type: "retry.end";
	success: boolean;
	attempt: number;
	finalError?: string;
}

export interface TodoItem {
	id: number;
	content: string;
	status: "pending" | "in_progress" | "done";
}

export interface TodoUpdateEvent extends SessionEventBase {
	type: "todo_update";
	items: TodoItem[];
}

/** 后台 bash 任务（run_in_background）的可序列化状态，随事件全量推送。 */
export interface BackgroundTaskInfo {
	id: string;
	command: string;
	cwd: string;
	status: "running" | "completed" | "failed" | "killed";
	outputFile: string;
	exitCode: number | undefined;
	startedAt: number;
	endedAt?: number;
	toolCallId?: string;
	/** 输出尾部（约 2KB），用于 UI 实时滚动显示。 */
	tail: string;
	/** status 为 killed 时，记录终止来源（user / agent / dispose）。 */
	endedBy?: "user" | "agent" | "dispose";
}

export interface BackgroundTasksUpdateEvent extends SessionEventBase {
	type: "background_tasks_update";
	tasks: BackgroundTaskInfo[];
}

/** Subagent child snapshot (full list on each update; mirrors background_tasks_update). */
export interface SubagentInfo {
	id: string;
	taskName: string;
	path: string;
	agentType: string;
	status: "queued" | "pending" | "running" | "completed" | "failed" | "interrupted";
	task: string;
	parentSessionId: string;
	sessionFile?: string;
	startedAt: number;
	endedAt?: number;
	finalText?: string;
	errorMessage?: string;
	generation: number;
	/** Workflow children mirror their todo progress (display only). */
	todoProgress?: { done: number; total: number };
	/** Human-readable one-line summary for UI display. */
	title?: string;
}

export interface SubagentsUpdateEvent extends SessionEventBase {
	type: "subagents_update";
	agents: SubagentInfo[];
}

/**
 * 会话激活工具集发生变化（插件在会话创建之后才注册/注销工具时触发）。
 * renderer 据此刷新输入栏 badge 的 `requiresActiveTool` 闸门——否则打开会话那一刻
 * 拿到的 `getState().activeToolNames` 快照会一直停留在插件就绪之前的旧集合。
 */
export interface ActiveToolsUpdateEvent extends SessionEventBase {
	type: "active_tools_update";
	activeToolNames: string[];
}

export interface CompactionStartEvent extends SessionEventBase {
	type: "compaction.start";
	reason: "threshold" | "overflow";
}

export interface CompactionEndEvent extends SessionEventBase {
	type: "compaction.end";
	success: boolean;
	errorMessage?: string;
}

export interface RuntimeUserConfirmationRequest {
	requestId: string;
	sessionId: string;
	title: string;
	message: string;
}

export interface RuntimeQuestionOption {
	label: string;
	description: string;
	badges?: string[];
}

export interface RuntimeQuestionItem {
	question: string;
	header: string;
	options: RuntimeQuestionOption[];
	multiSelect?: boolean;
}

export interface RuntimeUserQuestionRequest {
	requestId: string;
	sessionId: string;
	questions: RuntimeQuestionItem[];
}

export interface RuntimeUserQuestionAnswer {
	question: string;
	answers: string[];
}

export interface RuntimeUserQuestionResult {
	cancelled: boolean;
	answers: RuntimeUserQuestionAnswer[];
}

export type RuntimeSandboxGrantDecision = "deny" | "allow_once" | "allow_session";

export interface RuntimeSandboxGrantRequest {
	requestId: string;
	sessionId: string;
	title: string;
	message: string;
	toolName: string;
	capability: "file.read" | "file.write" | "network";
	target: string;
	resolvedTarget: string;
	grantRoot?: string;
	command?: string;
	/** True when the request involves a sensitive deny-root (e.g. ~/.ssh) — UI must hide the "allow for session" choice. */
	sensitive: boolean;
}

export interface RuntimeSandboxGrantInfo {
	id: string;
	sessionId: string;
	toolName: string;
	capability: "file.read" | "file.write" | "network";
	grantRoot: string;
	firstTarget: string;
	createdAt: number;
}

export type SessionEvent =
	| SessionLifecycleEvent
	| SessionPathChangedEvent
	| MessageDeltaEvent
	| ThinkingDeltaEvent
	| MessageFinalEvent
	| ToolCallGeneratingEvent
	| ToolStartEvent
	| ToolUpdateEvent
	| ToolPhaseEvent
	| ToolEndEvent
	| McpStatusEvent
	| McpReloadStartEvent
	| McpReloadEndEvent
	| UsageUpdateEvent
	| ErrorEvent
	| TodoUpdateEvent
	| BackgroundTasksUpdateEvent
	| SubagentsUpdateEvent
	| ActiveToolsUpdateEvent
	| CompactionStartEvent
	| CompactionEndEvent
	| RetryStartEvent
	| RetryEndEvent;

export interface SessionStateSnapshot {
	sessionId: string;
	model?: Model<any>;
	thinkingLevel: ThinkingLevel;
	executionMode: SessionExecutionMode;
	isStreaming: boolean;
	/** Timestamp (ms) for the current agent_start, if this session is streaming. */
	currentTurnStartedAt?: number;
	messageCount: number;
	/** Context window usage percentage (0-100), or null if unknown */
	contextPercent: number | null;
	/** Total context window size in tokens */
	contextWindow: number;
	/** 当前激活（模型可见）的工具名集合。renderer 据此让输入栏 badge 跟随工具 scope。 */
	activeToolNames: string[];
	/**
	 * 本会话的对话场景。renderer 据此让会话页插槽（活动面板插件标签卡 / 输入栏插件 toggle）
	 * 按对话类型显隐——与工具 scope_use 同一套场景轴。缺省（未显式传入）时为
	 * coding-agent 的 DEFAULT_SCENARIO（"cli"）。
	 */
	scenario: ConversationScenario;
	/** Parent session jsonl path when this session was forked. */
	parentSessionPath?: string;
	/** User entry id in the parent session this fork was created from. */
	parentEntryId?: string;
}

export interface ProjectInfo {
	cwd: string;
	sessionCount: number;
}

export interface SessionHistoryInfo {
	id: string;
	path: string;
	cwd: string;
	name?: string;
	firstMessage: string;
	modifiedAt: number;
	/** Trimmed preview (~120 chars) of the most recent user/assistant message text. */
	lastMessagePreview?: string;
	/** Parent session jsonl path when this session was forked. */
	parentSessionPath?: string;
	/** User entry id in the parent session this fork was created from. */
	parentEntryId?: string;
}

export type SessionExecutionMode = "sandbox" | "full-access";

export interface SessionConfig {
	cwd?: string;
	agentDir?: string;
	sessionPath?: string;
	sessionDir?: string;
	model?: Model<any>;
	thinkingLevel?: ThinkingLevel;
	executionMode?: SessionExecutionMode;
	/**
	 * 对话场景：决定按 scope_use 激活哪些工具（隔离的唯一轴）。不传则用 coding-agent 的
	 * DEFAULT_SCENARIO("cli")。desktop 各入口（普通对话/项目/批量/自动化）显式传入。
	 */
	scenario?: ConversationScenario;
	/** 工作模式（agent_mode 正交轴）。纯全局态，desktop 从 desktop-config 读入。缺省=不过滤。见 ADR-0046。 */
	agentMode?: string;
	/** 追加到 system prompt 末尾的文本，不会被上下文压缩 */
	appendSystemPrompt?: string;
	/**
	 * 注入到 bash/shell 工具子进程的环境变量覆盖层（如 TMPDIR/TEMP/TMP）。
	 * 仅对该 session 内的命令执行生效；不传则行为等同旧版。
	 */
	env?: Record<string, string>;
	/**
	 * 是否允许该 session 注册 ask_user_question 工具。
	 * 宿主仍可通过 setUserQuestionHandler 动态启停实际能力。
	 */
	askUserQuestion?: boolean;
	/**
	 * 是否启用后台 bash 任务（run_in_background）。默认 true。
	 * 按 session 生命周期编排执行的宿主场景（如批量任务）应置 false，
	 * 避免 agent 提前结束而进程仍在跑、完成通知凭空唤醒新 turn 干扰队列判定。
	 */
	enableBackgroundTasks?: boolean;
	/**
	 * 是否发现通用 Agent Skill 目录（`~/.agents/skills`、`<cwd>/.agents/skills`）。默认 true。
	 * desktop「适配通用 Agent Skill」开关关闭时置 false。
	 */
	includeAgentSkills?: boolean;
	/** Whether this session should receive Desktop plugin agent contributions on live plugin changes. */
	enableAgentPlugins?: boolean;
	/** Runtime plugin contributions applied while building agent prompts/resources. */
	agentPlugins?: AgentPluginRuntimeConfig;
}

export interface PromptRequest {
	text: string;
	/** Structured Skill / Scene selection. Kept separate from user-visible prompt text. */
	promptRef?: PromptResourceRef;
	/** Absolute filesystem references attached to this turn. Read by the agent on demand. */
	attachments?: PromptAttachmentRef[];
	images?: Array<{ type: "image"; data: string; mimeType: string }>;
	streamingBehavior?: "steer" | "followUp";
	/** Model key in "provider/modelId" format — ensures the prompt uses exactly this model */
	modelKey?: string;
	/**
	 * Per-turn reasoning effort, travelling alongside `modelKey` so the model and its
	 * chosen level stay consistent. Passed through to the agent's thinking level for this
	 * turn. Value is one of the selected model's configured reasoning levels (or "off").
	 */
	reasoning?: string;
	/**
	 * Per-turn metadata bag carried alongside the prompt. Not sent to the model
	 * as content; consumed host-side / by the input pipeline. Opaque pass-through.
	 * Known keys (coding-agent):
	 * - `{ pluginInstructions: string[] }` — hidden per-turn instructions
	 *   contributed by active plugins.
	 * - `{ knowledgeMode: true }` — hard isolation: exposes kb-read tools + hidden
	 *   knowledge-prefer instruction; without it those tools are stripped per turn.
	 */
	metadata?: Record<string, unknown>;
}

export interface SettingsPatch {
	thinkingLevel?: ThinkingLevel;
	steeringMode?: "all" | "one-at-a-time";
	followUpMode?: "all" | "one-at-a-time";
	/** Model key in "provider/modelId" format */
	modelKey?: string;
}

export interface AssistantTurnTiming {
	startedAt: number;
	endedAt: number;
	durationMs: number;
}

/** Sibling user-message versions under the same parent (for branch switch UI). */
export interface HistoryMessageBranch {
	/** entryIds of user-message siblings, oldest → newest */
	siblings: string[];
	/** Index of the current message within siblings */
	index: number;
}

/**
 * A history entry for UI display. Includes messages AND compaction boundaries.
 * The UI uses this to render complete conversation history (even after compaction).
 */
export type HistoryEntry =
	| {
			type: "message";
			/** Session tree entry id (coding-agent). */
			entryId?: string;
			parentId?: string | null;
			message: Message;
			/** Present on user messages when multiple sibling versions exist (or always when known). */
			branch?: HistoryMessageBranch;
	  }
	| {
			type: "compaction";
			entryId?: string;
			summary: string;
			tokensBefore: number;
			timestamp: string;
	  }
	| { type: "assistant_turn_timing"; timing: AssistantTurnTiming; timestamp: string }
	/**
	 * Marker that the next user message was sent via Settings AI assist
	 * (model-only instruction custom message precedes it). UI-only; not LLM content.
	 * tabId identifies the settings page for the badge label (e.g. "mcp" →「MCP配置协助」).
	 */
	| { type: "settings_assist_marker"; tabId?: string; timestamp: string }
	/** Marker that the next user message was sent with a structured Skill / Scene reference. */
	| { type: "prompt_ref_marker"; promptRef: PromptResourceRef; timestamp: string }
	/** Marker that the next user message was sent with structured filesystem attachments. */
	| { type: "prompt_attachments_marker"; attachments: PromptAttachmentRef[]; timestamp: string }
	| {
			type: "tool_timing";
			toolCallId: string;
			toolName: string;
			startedAt: number;
			durationMs: number;
			phases: ToolPhase[];
			timestamp: string;
	  };

export interface SessionFacade {
	setUserConfirmationHandler(
		handler: ((request: RuntimeUserConfirmationRequest, signal?: AbortSignal) => Promise<boolean>) | undefined,
	): void;
	setUserQuestionHandler(
		handler:
			| ((request: RuntimeUserQuestionRequest, signal?: AbortSignal) => Promise<RuntimeUserQuestionResult>)
			| undefined,
	): void;
	setUserSandboxGrantHandler(
		handler:
			| ((request: RuntimeSandboxGrantRequest, signal?: AbortSignal) => Promise<RuntimeSandboxGrantDecision>)
			| undefined,
	): void;
	setPluginToolInvoker(handler: AgentPluginToolInvoker | undefined): void;
	setPluginContinuationInvoker(handler: AgentPluginContinuationInvoker | undefined): void;
	setPluginSystemPromptInvoker(handler: AgentPluginSystemPromptInvoker | undefined): void;
	reconfigureAgentPlugins(agentPlugins: AgentPluginRuntimeConfig | undefined): void;
	listSandboxGrants(sessionId: string): RuntimeSandboxGrantInfo[];
	revokeSandboxGrant(sessionId: string, grantId: string): boolean;
	revokeAllSandboxGrants(sessionId: string): number;
	createSession(config?: SessionConfig): Promise<{ sessionId: string }>;
	setExecutionMode(sessionId: string, mode: SessionExecutionMode): Promise<void>;
	setGlobalExecutionMode(mode: SessionExecutionMode): Promise<void>;
	prompt(sessionId: string, request: PromptRequest): Promise<void>;
	continue(sessionId: string): Promise<void>;
	abort(sessionId: string): Promise<void>;
	subscribe(sessionId: string, handler: (event: SessionEvent) => void): () => void;
	updateSettings(sessionId: string, partialSettings: SettingsPatch): Promise<void>;
	/** Update thinking level for ALL open sessions at once. */
	updateGlobalThinkingLevel(level: ThinkingLevel): void;
	getState(sessionId: string): SessionStateSnapshot;
	getMessages(sessionId: string): Message[];
	/** Full conversation history including compaction boundaries (for UI display). */
	getFullHistory(sessionId: string): HistoryEntry[];
	/**
	 * Read a session .jsonl directly from disk and translate to
	 * HistoryEntry[] without acquiring the session-file lock. Used by the
	 * desktop sidebar's read-only viewer for sessions written by other
	 * processes (e.g. IM gateway). The caller infers whether the session
	 * is IM-owned from the path (it lives under the IM conversation cwd).
	 */
	readSessionHistoryFromFile(path: string): { history: HistoryEntry[] };
	/**
	 * Prepare re-edit of a user message: set leaf to its parent and return text.
	 * Caller should then prompt with (possibly edited) text to grow a new branch.
	 */
	navigateForEdit(sessionId: string, entryId: string): Promise<{ text: string; cancelled: boolean }>;
	/** Switch current leaf to the tip of the subtree rooted at entryId (sibling branch). */
	switchBranch(sessionId: string, entryId: string): Promise<{ leafId: string }>;
	/** Delete one message and reparent its descendants to the deleted message's parent. */
	deleteMessage(sessionId: string, entryId: string): Promise<{ leafId: string | null }>;
	/** Remove the active branch's last user turn before sending its edited replacement. */
	replaceLastUserMessage(sessionId: string, entryId: string): Promise<{ leafId: string | null }>;
	/**
	 * Export a fork as a new session file without leaving the current session.
	 * Copies history through the selected user message and that turn's complete reply.
	 */
	forkSession(sessionId: string, entryId: string): Promise<{ path: string; text: string }>;
	listProjects(): Promise<ProjectInfo[]>;
	listSessions(cwd: string, sessionDir?: string): Promise<SessionHistoryInfo[]>;
	deleteSession(sessionPath: string): Promise<void>;
	renameSession(sessionPath: string, name: string): Promise<void>;
	getSessionPath(sessionId: string): string | undefined;
	renameSessionById(sessionId: string, name: string): Promise<void>;
	autoTitleSession(sessionId: string, userText: string, assistantText: string): Promise<string | null>;
	disposeSession(sessionId: string): Promise<void>;
	disposeAllSessions(): Promise<void>;
}
