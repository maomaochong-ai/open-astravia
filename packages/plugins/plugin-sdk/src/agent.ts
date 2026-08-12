import type { PluginConversationApi } from "./conversation.js";
import type { Disposable } from "./disposable.js";
import type { PluginFsApi } from "./fs.js";
import type { ConversationScenario } from "./scenario.js";

export type PluginJsonSchema = object;

export interface PluginAgentToolApi {
	fs: PluginFsApi;
	conversation: PluginConversationApi;
}

export interface PluginAgentToolRegistration<TInput = unknown> {
	id: string;
	name?: string;
	/**
	 * Host UI display name for this tool (e.g. Work-mode tool headers).
	 * Supports `%catalogKey%` resolved against the plugin's locales; bare strings
	 * are used as literals. Not sent to the model — use {@link description} for that.
	 */
	label?: string;
	description: string;
	parameters: PluginJsonSchema;
	timeoutMs?: number;
	/**
	 * 允许该工具出现的对话场景 slug 列表。**fail-closed**：未声明/空数组 = 所有场景都不激活。
	 * 插件须显式声明。
	 */
	scope_use?: readonly ConversationScenario[];
	/** 需要的会话能力 slug（如 "knowledge"）；全满足才激活。一般插件无需设置。 */
	requires?: string[];
	/**
	 * 该工具偏好的工作模式 slug（如 "work"/"coding"）。**纯偏好，不排除**：
	 * 声明后工具在其它模式下依旧可用，宿主只据此调整排序与提示词详略。
	 */
	agent_mode?: readonly string[];
	context?: { conversation?: "summary" | "messages" };
	handler: PluginAgentToolHandler<TInput>;
}

export interface PluginSystemPromptBlock {
	id: string;
	content: string;
	priority?: number;
	enabled?: boolean;
}

export type PluginDynamicSystemPromptOperation =
	| { type: "addBlock"; block: PluginSystemPromptBlock }
	| { type: "replaceBlock"; blockId: string; block: Omit<PluginSystemPromptBlock, "id"> }
	| {
			type: "updateBlock";
			blockId: string;
			patch: Partial<Pick<PluginSystemPromptBlock, "content" | "priority" | "enabled">>;
	  }
	| { type: "removeBlock"; blockId: string }
	| { type: "setBlockEnabled"; blockId: string; enabled: boolean }
	| { type: "setToolEnabled"; toolName: string; enabled: boolean }
	| { type: "requestContinuation"; result: PluginContinuationResult };

export interface PluginSystemPromptMessage {
	role: string;
	text: string;
	timestamp?: number;
	toolName?: string;
}

export interface PluginSystemPromptProviderContext {
	plugin: {
		id: string;
		providerId: string;
		settings: Readonly<Record<string, unknown>>;
	};
	session: {
		id: string;
		cwd: string;
		scenario: ConversationScenario;
	};
	model: {
		provider: string;
		id: string;
		api: string;
		input: readonly string[];
		contextWindow?: number;
		maxTokens?: number;
	};
	conversation: {
		messages: readonly PluginSystemPromptMessage[];
		messageCount: number;
	};
	runtime: {
		activeToolNames: readonly string[];
		availableToolNames: readonly string[];
		runIndex: number;
	};
	trigger: {
		kind: "agent-run";
		timestamp: number;
	};
	systemPrompt?: {
		base: {
			blocks?: readonly PluginSystemPromptBlockView[];
			rendered?: string;
		};
		current: {
			blocks?: readonly PluginSystemPromptBlockView[];
			rendered?: string;
		};
	};
}

export interface PluginSystemPromptBlockView extends PluginSystemPromptBlock {
	type: string;
	source: {
		kind: "core" | "plugin";
		pluginId?: string;
	};
	priority: number;
	enabled: boolean;
}

export interface PluginAgentActions {
	systemPrompt: {
		addBlock(block: PluginSystemPromptBlock): void;
		replaceBlock(blockId: string, block: Omit<PluginSystemPromptBlock, "id">): void;
		updateBlock(
			blockId: string,
			patch: Partial<Pick<PluginSystemPromptBlock, "content" | "priority" | "enabled">>,
		): void;
		removeBlock(blockId: string): void;
		setBlockEnabled(blockId: string, enabled: boolean): void;
	};
	tools: {
		setEnabled(toolName: string, enabled: boolean): void;
		enable(toolName: string): void;
		disable(toolName: string): void;
	};
	continuation: {
		request(result: PluginContinuationResult): void;
	};
}

export interface PluginAgentHandlerContext<TTrigger> {
	invocationId: string;
	plugin: {
		id: string;
		contributionId: string;
		settings: Readonly<Record<string, unknown>>;
	};
	session: PluginSystemPromptProviderContext["session"];
	model: PluginSystemPromptProviderContext["model"];
	conversation: PluginSystemPromptProviderContext["conversation"];
	runtime: PluginSystemPromptProviderContext["runtime"];
	trigger: TTrigger;
	systemPrompt?: PluginSystemPromptProviderContext["systemPrompt"];
	actions: PluginAgentActions;
	host: PluginAgentToolApi;
}

export type PluginAgentToolHandler<TInput = unknown> = (
	context: PluginAgentHandlerContext<{
		kind: "tool-call";
		timestamp: number;
		toolCallId: string;
		toolId: string;
		toolName: string;
		input: TInput;
	}>,
) => unknown | Promise<unknown>;

export type PluginSystemPromptProviderHandler = (
	context: PluginAgentHandlerContext<{ kind: "agent-run"; timestamp: number }>,
) => void | PluginDynamicSystemPromptOperation[] | Promise<void | PluginDynamicSystemPromptOperation[]>;

export interface PluginSystemPromptProviderRegistration {
	id: string;
	timeoutMs?: number;
	/**
	 * Large context is opt-in. Omitted fields are not serialized across the
	 * host/renderer boundary.
	 */
	context?: {
		systemPrompt?: "none" | "blocks" | "rendered" | "full";
		conversation?: "summary" | "messages";
	};
	handler: PluginSystemPromptProviderHandler;
}

export interface PluginContinuationResult {
	text: string;
	/** Stable key used by the host to suppress duplicate continuations in a session. */
	idempotencyKey?: string;
}

export type PluginContinuationHandler = (
	context: PluginAgentHandlerContext<{ kind: "continuation"; timestamp: number }>,
) => PluginContinuationResult | null | Promise<PluginContinuationResult | null>;

export interface PluginContinuationRegistration {
	id: string;
	timeoutMs?: number;
	context?: { conversation?: "summary" | "messages" };
	handler: PluginContinuationHandler;
}

export const PLUGIN_CODING_AGENT_HOOK_EVENT_NAMES = [
	"SessionStart",
	"SessionEnd",
	"UserPromptSubmit",
	"PreToolUse",
	"PermissionRequest",
	"PostToolUse",
	"PostToolUseFailure",
	"PreCompact",
	"PostCompact",
	"SubagentStart",
	"SubagentStop",
	"Stop",
] as const;

export type PluginCodingAgentHookEventName = (typeof PLUGIN_CODING_AGENT_HOOK_EVENT_NAMES)[number];
export type PluginCodingAgentPermissionMode =
	| "default"
	| "acceptEdits"
	| "plan"
	| "dontAsk"
	| "bypassPermissions";

export interface PluginCodingAgentHookTool {
	hostName: string;
	kind: "function" | "shell" | "mcp" | "file-edit" | "agent" | "custom";
	source?: { ecosystem?: string; serverName?: string; originalName?: string };
}

interface PluginCodingAgentHookEventBase {
	sessionId: string;
	cwd: string;
	model: string;
	permissionMode: PluginCodingAgentPermissionMode;
	subagent?: { agentId: string; agentType: string };
}

export type PluginCodingAgentHookEvent =
	| (PluginCodingAgentHookEventBase & {
			eventName: "SessionStart";
			source: "startup" | "resume" | "clear" | "compact";
		})
	| (PluginCodingAgentHookEventBase & {
			eventName: "SessionEnd";
			cause: "new_session" | "switch_session" | "fork_session" | "dispose";
		})
	| (PluginCodingAgentHookEventBase & { eventName: "UserPromptSubmit"; turnId: string; prompt: string })
	| (PluginCodingAgentHookEventBase & {
			eventName: "PreToolUse";
			turnId: string;
			tool: PluginCodingAgentHookTool;
			toolUseId: string;
			toolInput: unknown;
		})
	| (PluginCodingAgentHookEventBase & {
			eventName: "PermissionRequest";
			turnId: string;
			tool: PluginCodingAgentHookTool;
			toolInput: unknown;
			runIdSuffix: string;
		})
	| (PluginCodingAgentHookEventBase & {
			eventName: "PostToolUse";
			turnId: string;
			tool: PluginCodingAgentHookTool;
			toolUseId: string;
			toolInput: unknown;
			toolResponse: unknown;
		})
	| (PluginCodingAgentHookEventBase & {
			eventName: "PostToolUseFailure";
			turnId: string;
			tool: PluginCodingAgentHookTool;
			toolUseId: string;
			toolInput: unknown;
			error: string;
			isInterrupt?: boolean;
			durationMs?: number;
		})
	| (PluginCodingAgentHookEventBase & {
			eventName: "PreCompact" | "PostCompact";
			turnId: string;
			trigger: "manual" | "auto";
		})
	| (PluginCodingAgentHookEventBase & {
			eventName: "SubagentStart";
			turnId: string;
			agentId: string;
			agentType: string;
		})
	| (PluginCodingAgentHookEventBase & {
			eventName: "SubagentStop";
			turnId: string;
			agentId: string;
			agentType: string;
			stopHookActive: boolean;
			lastAssistantMessage: string | null;
		})
	| (PluginCodingAgentHookEventBase & {
			eventName: "Stop";
			turnId: string;
			stopHookActive: boolean;
			lastAssistantMessage: string | null;
		});

export type PluginCodingAgentHookEventOf<E extends PluginCodingAgentHookEventName> = Extract<
	PluginCodingAgentHookEvent,
	{ eventName: E }
>;

interface PluginCodingAgentHookContinueResult {
	action: "continue";
	additionalContexts?: readonly string[];
	feedbackMessage?: string;
}

type PluginCodingAgentHookTerminalResult =
	| { action: "block"; reason: string }
	| { action: "stop"; reason?: string };

export type PluginCodingAgentHookResult<E extends PluginCodingAgentHookEventName> =
	| PluginCodingAgentHookTerminalResult
	| (PluginCodingAgentHookContinueResult &
			(E extends "PreToolUse" ? { updatedToolInput?: Record<string, unknown> } : object) &
			(E extends "PermissionRequest"
				? { permissionDecision?: "allow" | "deny"; permissionMessage?: string }
				: object))
	| (E extends "Stop" | "SubagentStop"
			? { action: "continue-agent"; continuationFragments: readonly string[] }
			: never);

export interface PluginCodingAgentHookHandlerContext<E extends PluginCodingAgentHookEventName> {
	invocationId: string;
	plugin: {
		id: string;
		contributionId: string;
		settings: Readonly<Record<string, unknown>>;
	};
	session: { id: string; cwd: string; scenario: ConversationScenario };
	event: PluginCodingAgentHookEventOf<E>;
	host: PluginAgentToolApi;
}

export type PluginCodingAgentHookHandler<E extends PluginCodingAgentHookEventName> = (
	context: PluginCodingAgentHookHandlerContext<E>,
) => void | PluginCodingAgentHookResult<E> | Promise<void | PluginCodingAgentHookResult<E>>;

export interface PluginCodingAgentHookRegistration<
	E extends PluginCodingAgentHookEventName = PluginCodingAgentHookEventName,
> {
	id: string;
	eventName: E;
	/** Hook 是可执行贡献，必须显式声明允许出现的会话场景。 */
	scope_use: readonly ConversationScenario[];
	/** 偏好的工作模式声明；**不影响触发**：hook 在任何模式下都会按 scope_use 与 matcher 触发。 */
	agent_mode?: readonly string[];
	/** 工具事件只匹配列出的宿主工具名；缺省/空数组表示所有工具。 */
	toolNames?: readonly string[];
	timeoutMs?: number;
	handler: PluginCodingAgentHookHandler<E>;
}

export interface PluginAgentApi {
	registerTool<TInput = unknown>(registration: PluginAgentToolRegistration<TInput>): Disposable;
	/** Register a provider evaluated before every Agent run. */
	registerSystemPromptProvider(registration: PluginSystemPromptProviderRegistration): Disposable;
	/**
	 * Register a policy consulted when the agent reaches a natural stopping point.
	 * Return null to allow the agent to stop, or a message to continue with another turn.
	 */
	registerContinuationProvider(registration: PluginContinuationRegistration): Disposable;
	/** Register a typed, dynamically removable Coding Agent lifecycle hook. */
	registerHook<E extends PluginCodingAgentHookEventName>(
		registration: PluginCodingAgentHookRegistration<E>,
	): Disposable;
}
