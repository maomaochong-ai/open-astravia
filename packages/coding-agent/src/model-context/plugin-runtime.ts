/** Coding Agent plugin contributions and invocation contracts used during model-context composition. */

import type { SystemPromptBlock, SystemPromptContribution, SystemPromptOperation } from "./prompt-document.js";

export interface SkillPathContribution {
	pluginId: string;
	paths: string[];
}

export interface ToolPolicyContribution {
	pluginId: string;
	allow?: string[];
	deny?: string[];
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
	activationId?: string;
	timeoutMs?: number;
	/** 允许出现的对话场景 slug（fail-closed：缺省/空 = 所有场景都不激活）。由插件 registerTool 声明。 */
	scope_use?: string[];
	/** 需要的会话能力 slug（如 "knowledge"）。 */
	requires?: string[];
	/** 主推的工作模式 slug（agent_mode 轴，缺省/空 = 通用）。纯排序偏好，不排除工具。见 ADR-0046 修订。 */
	agent_mode?: string[];
	/**
	 * 副作用等级（"light" | "heavy"，缺省 = light）。宿主侧元数据，不进 LLM schema。
	 * heavy 工具在会话内首次调用前需要用户确认，见 tool-policy/heavy-tool-confirmation.ts。
	 */
	side_effect?: string;
	context?: { conversation?: "summary" | "messages" };
	/**
	 * 该工具带有宿主自渲染卡片（插件注册了 tool-call slot），其结果是用户当作答案来读的
	 * 产物。宿主据此为它追加一个可选的 `md_intro` 参数：模型填的这段 markdown 会渲染在
	 * 卡片正上方，作为产物的一句话说明。插件无需感知，宿主自动检测并注入。见 ADR-0047。
	 */
	rendersCard?: boolean;
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
	activationId?: string;
	timeoutMs?: number;
	context?: { conversation?: "summary" | "messages" };
}

export interface AgentPluginSystemPromptProviderContribution {
	pluginId: string;
	id: string;
	handlerId: string;
	activationId?: string;
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
	activationId?: string;
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

/**
 * Plugin-scoped MCP server config (aligned with `McpServerConfig`). Host resolves
 * relative paths before injecting into the runtime.
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

export interface McpServerContribution {
	pluginId: string;
	localName: string;
	/** Unique runtime key; must not contain `_` (tool name adapter constraint). */
	runtimeName: string;
	config: AgentPluginMcpServerConfig;
	/** 该 server 的工具主推的工作模式 slug（agent_mode 轴，缺省/空 = 通用）。纯排序偏好，不排除工具。见 ADR-0046 修订。 */
	agent_mode?: string[];
}

export interface AgentPluginRuntimeConfig {
	systemPromptContributions?: SystemPromptContribution[];
	skillPathContributions?: SkillPathContribution[];
	toolPolicyContributions?: ToolPolicyContribution[];
	toolContributions?: AgentPluginToolContribution[];
	stateContributions?: AgentPluginStateContribution[];
	continuationContributions?: AgentPluginContinuationContribution[];
	systemPromptProviderContributions?: AgentPluginSystemPromptProviderContribution[];
	/** Plugin-scoped MCP (third source; never written to user mcp.json). */
	mcpServerContributions?: McpServerContribution[];
}

export interface AgentPluginToolInvocation {
	pluginId: string;
	toolId: string;
	toolName: string;
	handlerId: string;
	activationId?: string;
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
	activationId?: string;
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
