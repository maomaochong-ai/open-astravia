/**
 * Public types for AgentSession.
 *
 * Extracted from agent-session.ts. Re-exported from there to preserve the
 * existing import paths for external consumers.
 */

import type { Agent, AgentEvent, AgentTool, ThinkingLevel } from "@vetta/agent-core";
import type { ImageContent, Model } from "@vetta/ai";
import type { HookConfigLayer } from "@vetta/ecosystem-adapter/hooks";
import type { BackgroundTaskSnapshot } from "../background-tasks/index.js";
import type { CompactionResult } from "../compaction/index.js";
import type {
	ExtensionCommandContextActions,
	ExtensionErrorListener,
	ExtensionRunner,
	ExtensionUIContext,
	InputSource,
	ShutdownHandler,
	ToolDefinition,
} from "../extensions/index.js";
import type { EcosystemHookAdapterFactory } from "../hooks/index.js";
import type { ModelRegistry } from "../model-registry.js";
import type { ResourceLoader } from "../resource-loader.js";
import type { SessionManager } from "../session-manager/index.js";
import type { SettingsManager } from "../settings-manager.js";
import type { SubagentSessionFactory, SubagentSnapshot, SubagentTypeRegistry } from "../subagents/index.js";
import type {
	AgentPluginContinuationInvoker,
	AgentPluginRuntimeConfig,
	AgentPluginSystemPromptInvoker,
	AgentPluginToolInvoker,
} from "../system-prompt.js";
import type { TodoItem } from "../todo-store.js";
import type { AskUserQuestionCapability } from "../tools/index.js";
import type { ConversationScenario } from "./tool-scope.js";

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent =
	| AgentEvent
	| { type: "auto_compaction_start"; reason: "threshold" | "overflow" }
	| {
			type: "auto_compaction_end";
			result: CompactionResult | undefined;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
	| { type: "todo_update"; items: ReadonlyArray<TodoItem> }
	| { type: "background_tasks_update"; tasks: ReadonlyArray<BackgroundTaskSnapshot> }
	| { type: "subagents_update"; agents: ReadonlyArray<SubagentSnapshot> }
	| { type: "mcp_reload_start" }
	| { type: "mcp_reload_end"; changed: boolean; errorMessage?: string }
	// memory-mode session rollover (ADR-0009): the active session jsonl changed.
	// The host (im-gateway) repoints its routing state at `to`.
	| { type: "session_path_changed"; from: string | undefined; to: string; reason: "rollover" };

/** Listener function for agent session events */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

export interface AgentSessionConfig {
	agent: Agent;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	cwd: string;
	/** Models to cycle through with Ctrl+P (from --models flag) */
	scopedModels?: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }>;
	/** Resource loader for skills, prompts, themes, context files, system prompt */
	resourceLoader: ResourceLoader;
	/** SDK custom tools registered outside extensions */
	customTools?: ToolDefinition[];
	/** Model registry for API key resolution and model discovery */
	modelRegistry: ModelRegistry;
	/** Additional external-ecosystem Hook adapters composed with built-in adapters. */
	additionalHookAdapterFactories?: readonly EcosystemHookAdapterFactory[];
	/**
	 * Hook config layers for ecosystem adapters (Codex + Claude).
	 * Default (via createAgentSession): Vetta-nested official layouts only —
	 * `~/.vetta/.codex/hooks.json`, `~/.vetta/.claude/settings.json`,
	 * `<cwd>/.vetta/.codex/hooks.json`, `<cwd>/.vetta/.claude/settings.json|settings.local.json`.
	 * Does not auto-load top-level `~/.codex` / `~/.claude` or project-root `.codex`/`.claude`.
	 */
	hookConfigLayers?: readonly HookConfigLayer[];
	/** 对话场景：决定按 scope_use 激活哪些工具。默认 DEFAULT_SCENARIO("cli")。 */
	scenario?: ConversationScenario;
	/** 工作模式（agent_mode 正交轴）。不传=不按模式过滤。见 ADR-0046。 */
	agentMode?: string;
	/** Initial active built-in tool names. Default: [read, command-tool, edit, write] */
	initialActiveToolNames?: string[];
	/** Override base tools (useful for custom runtimes). */
	baseToolsOverride?: Record<string, AgentTool>;
	/** Mutable ref used by Agent to access the current ExtensionRunner */
	extensionRunnerRef?: { current?: ExtensionRunner };
	/** Enable MCP (Model Context Protocol) support (default: true) */
	enableMcp?: boolean;
	/** Enable MCP debug logging (default: false) */
	mcpDebug?: boolean;
	/**
	 * 注入到 bash/shell 工具子进程的环境变量覆盖层（合并到默认 shell env 之上）。
	 * 用于把 TMPDIR/TEMP/TMP 等系统级路径重定向到 session 私有目录。
	 */
	envOverlay?: Record<string, string>;
	/**
	 * memory-mode：启用 MEMORY.md 跨会话记忆注入 + memory 工具 + session
	 * rollover + 日期工作史（ADR-0009）。仅 im-gateway 为 Claw cwd 启用，默认关。
	 */
	memoryMode?: boolean;
	/** MEMORY.md 的绝对路径（run cwd 无关的稳定位置）。memoryMode 下必填。 */
	memoryFile?: string;
	/** MEMORY.md 字符预算（默认 DEFAULT_MEMORY_CHAR_LIMIT）。 */
	memoryCharLimit?: number;
	/**
	 * 宿主提供的「向用户提问」能力（ask_user_question 工具的后端）。
	 * `isEnabled()` 在每个 prompt 入口被实时读取——能力存在与否即工具是否注册，
	 * 故开关可在不重启 session 的情况下动态生效。
	 */
	askUserQuestion?: AskUserQuestionCapability;
	/**
	 * 是否启用后台 bash 任务（run_in_background）。默认 true。
	 * 置 false 时 bash/shell 不接受 run_in_background（返回明确错误引导同步执行），
	 * task_output / task_stop 工具不注册。用于按 session 生命周期编排执行的宿主
	 * 场景（如桌面批量任务）——后台任务会让 agent 提前 agent_end 而进程仍在跑，
	 * 完成通知又会凭空唤醒新 turn，干扰队列对「任务完成」的判定。
	 */
	enableBackgroundTasks?: boolean;
	/**
	 * Enable root-side subagent tools + coordinator. Fail-closed default: false.
	 * Child sessions created by the coordinator always pass false.
	 */
	enableSubagents?: boolean;
	/** Optional type registry (default: explorer only when enableSubagents). */
	subagentTypeRegistry?: SubagentTypeRegistry;
	/** Optional child session factory (default: in-process createAgentSession factory). */
	subagentSessionFactory?: SubagentSessionFactory;
	/** Max concurrent pending/running children (default 3). */
	subagentMaxConcurrent?: number;
	/** Runtime plugin contributions applied while building agent prompts/resources. */
	agentPlugins?: AgentPluginRuntimeConfig;
	/** Host bridge used by plugin-contributed tools. */
	invokePluginTool?: AgentPluginToolInvoker;
	/** Host bridge used by plugin continuation providers. */
	invokePluginContinuation?: AgentPluginContinuationInvoker;
	invokePluginSystemPrompt?: AgentPluginSystemPromptInvoker;
}

export interface ExtensionBindings {
	uiContext?: ExtensionUIContext;
	commandContextActions?: ExtensionCommandContextActions;
	shutdownHandler?: ShutdownHandler;
	onError?: ExtensionErrorListener;
}

/** Options for AgentSession.prompt() */
export interface PromptResourceRef {
	kind: "skill" | "scene";
	name: string;
}

/** Absolute filesystem reference attached to one user prompt. */
export interface PromptAttachmentRef {
	kind: "file" | "directory" | "image";
	path: string;
}

export interface PromptOptions {
	/** Whether to expand file-based prompt templates (default: true) */
	expandPromptTemplates?: boolean;
	/** Image attachments */
	images?: ImageContent[];
	/** When streaming, how to queue the message: "steer" (interrupt) or "followUp" (wait). Required if streaming. */
	streamingBehavior?: "steer" | "followUp";
	/** Structured Skill / Scene selection. Expanded before the user message is sent to the model. */
	promptRef?: PromptResourceRef;
	/** Structured filesystem attachments. The agent reads them on demand with tools. */
	attachments?: PromptAttachmentRef[];
	/** Source of input for extension input event handlers. Defaults to "interactive". */
	source?: InputSource;
	/**
	 * Per-turn metadata carried from the host's PromptRequest. Not sent to the
	 * model as content; consumed in the input pipeline:
	 * - `{ pluginInstructions: string[] }` — hidden instructions contributed by
	 *   active plugins for this turn.
	 * - `{ pluginPromptContexts: PluginPromptContext[] }` — versioned structured
	 *   application state attached by plugins and projected model-side once.
	 * - `{ knowledgeMode: true }` — hard isolation: exposes kb-read tools and
	 *   injects a hidden “prefer knowledge base” instruction; without it those
	 *   tools are stripped for this turn (except kb-processing scenario).
	 */
	metadata?: Record<string, unknown>;
}
