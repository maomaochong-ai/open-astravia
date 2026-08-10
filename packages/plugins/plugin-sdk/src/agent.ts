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
	/** 允许该工具出现的工作模式 slug（agent_mode 轴，如 "work"/"coding"）。缺省/空 = 通用。见 ADR-0046。 */
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

export type PluginAgentHookPoint = "tool.before" | "tool.after" | "tool.error";

export type PluginAgentHookContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };

export type PluginAgentHookTrigger<P extends PluginAgentHookPoint> = P extends "tool.before"
	? {
			kind: "tool.before";
			timestamp: number;
			toolCallId: string;
			toolName: string;
			input: Readonly<Record<string, unknown>>;
		}
	: P extends "tool.after"
		? {
				kind: "tool.after";
				timestamp: number;
				toolCallId: string;
				toolName: string;
				input: Readonly<Record<string, unknown>>;
				result: { content: readonly PluginAgentHookContent[]; details?: unknown };
			}
		: {
				kind: "tool.error";
				timestamp: number;
				toolCallId: string;
				toolName: string;
				input: Readonly<Record<string, unknown>>;
				error: string;
				aborted: boolean;
			};

export type PluginAgentHookResult<P extends PluginAgentHookPoint> = P extends "tool.before"
	? { action: "continue"; input?: Record<string, unknown> } | { action: "block"; reason: string }
	: P extends "tool.after"
		?
				| { action: "continue" }
				| { action: "replace"; content?: PluginAgentHookContent[]; details?: unknown }
				| { action: "block"; reason: string }
		: { action: "continue" } | { action: "feedback"; text: string };

export type PluginAgentHookHandler<P extends PluginAgentHookPoint> = (
	context: PluginAgentHandlerContext<PluginAgentHookTrigger<P>>,
) => void | PluginAgentHookResult<P> | Promise<void | PluginAgentHookResult<P>>;

export interface PluginAgentHookRegistration<P extends PluginAgentHookPoint = PluginAgentHookPoint> {
	id: string;
	point: P;
	/** Hook 是可执行贡献，必须显式声明允许出现的会话场景。 */
	scope_use: readonly ConversationScenario[];
	/** 允许出现的工作模式；缺省/空数组表示通用。 */
	agent_mode?: readonly string[];
	/** 只匹配列出的工具；缺省/空数组表示所有工具。 */
	toolNames?: readonly string[];
	timeoutMs?: number;
	context?: { conversation?: "summary" | "messages" };
	handler: PluginAgentHookHandler<P>;
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
	/** Register a typed, dynamically removable Agent execution hook. */
	registerHook<P extends PluginAgentHookPoint>(registration: PluginAgentHookRegistration<P>): Disposable;
}
