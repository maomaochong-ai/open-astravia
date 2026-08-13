import type { ThinkingLevel } from "@vetta/agent-core";
import type { Api, Model } from "@vetta/ai";
import type { EcosystemHookAdapterFactory } from "@vetta/ecosystem-adapter";
import type {
	AgentPluginContinuationInvoker,
	AgentPluginRuntimeConfig,
	AgentPluginSystemPromptInvoker,
	AgentPluginToolInvoker,
	AgentPluginTurnHandlerLeaseProvider,
	ConversationScenario,
} from "@vetta/runtime-core";
import type { RuntimeTracer } from "@vetta/runtime-telemetry";
import type {
	CodingAgentExtensionSource,
	CodingAgentSkillContribution,
	CodingAgentSkillPolicy,
	CodingAgentSkillSource,
} from "./sdk-resource-source-contract.js";
import type { CodingAgentSession } from "./sdk-session-contract.js";
import type { CodingAgentSessionToolDefinition } from "./sdk-tool-contract.js";

export type CodingAgentSessionStorageTarget =
	| { readonly kind: "memory"; readonly sessionId?: string }
	| {
			readonly kind: "file-create";
			readonly conversationDir: string;
			readonly sessionId?: string;
	  }
	| {
			readonly kind: "file-resume";
			readonly conversationDir: string;
			readonly sessionPath: string;
	  };

export interface CodingAgentQuestionOption {
	readonly label: string;
	readonly description: string;
	readonly badges?: readonly string[];
}

export interface CodingAgentQuestionItem {
	readonly question: string;
	readonly header: string;
	readonly options: readonly CodingAgentQuestionOption[];
	readonly multiSelect?: boolean;
}

export interface CodingAgentQuestionRequest {
	readonly questions: readonly CodingAgentQuestionItem[];
}

export interface CodingAgentQuestionAnswer {
	readonly question: string;
	readonly answers: readonly string[];
}

export interface CodingAgentQuestionResult {
	readonly cancelled: boolean;
	readonly answers: readonly CodingAgentQuestionAnswer[];
}

export interface CodingAgentContextFileContribution {
	readonly path: string;
	readonly content: string;
}

export interface CodingAgentPromptTemplateContribution {
	readonly name: string;
	readonly description: string;
	readonly content: string;
	readonly filePath?: string;
}

/**
 * 公共 SDK 的资源值输入。路径资源会在 `session.reload()` 时重新发现；内联资源随 Session 保持。
 *
 * 这里只表达产品需要的资源，不暴露具体 Loader、覆盖回调或资源缓存实现。
 */
export interface CodingAgentResourceContributions {
	readonly systemPrompt?: string;
	readonly extensionPaths?: readonly string[];
	readonly skillPaths?: readonly string[];
	readonly skills?: readonly CodingAgentSkillContribution[];
	readonly skillPolicy?: CodingAgentSkillPolicy;
	readonly promptTemplatePaths?: readonly string[];
	readonly promptTemplates?: readonly CodingAgentPromptTemplateContribution[];
	readonly contextFiles?: readonly CodingAgentContextFileContribution[];
}

/** 宿主提供的实时提问能力，不暴露具体 UI 实现。 */
export interface CodingAgentQuestionCapability {
	isEnabled(): boolean;
	ask(request: CodingAgentQuestionRequest, signal?: AbortSignal): Promise<CodingAgentQuestionResult>;
}

/**
 * 新公共 SDK 的值对象和窄能力参数。
 *
 * 具体认证、模型、设置、资源和存储管理器只属于产品 Composition Root，
 * 不进入该合同。
 */
export interface CreateCodingAgentSessionOptions {
	readonly cwd?: string;
	/** Agent 配置根目录；未显式提供 `storage` 时也作为默认会话存储根目录。 */
	readonly agentDir?: string;
	readonly storage?: CodingAgentSessionStorageTarget;
	readonly model?: Model<Api>;
	readonly thinkingLevel?: ThinkingLevel;
	readonly scopedModels?: readonly { readonly model: Model<Api>; readonly thinkingLevel: ThinkingLevel }[];
	/** 显式激活的内置工具名；不传时由 scenario 解析。 */
	readonly activeTools?: readonly string[];
	readonly scenario?: ConversationScenario;
	readonly agentMode?: string;
	readonly customTools?: readonly CodingAgentSessionToolDefinition[];
	readonly additionalHookAdapterFactories?: readonly EcosystemHookAdapterFactory[];
	readonly appendSystemPrompt?: string;
	readonly resources?: CodingAgentResourceContributions;
	readonly skillSources?: readonly CodingAgentSkillSource[];
	readonly extensionSources?: readonly CodingAgentExtensionSource[];
	readonly includeAgentSkills?: boolean;
	readonly env?: Readonly<Record<string, string>>;
	readonly memoryMode?: boolean;
	readonly memoryFile?: string;
	readonly memoryCharLimit?: number;
	readonly askUserQuestion?: CodingAgentQuestionCapability;
	readonly enableBackgroundTasks?: boolean;
	readonly enableSubagents?: boolean;
	readonly subagentMaxConcurrent?: number;
	readonly enableMcp?: boolean;
	readonly serverUrl?: string;
	readonly tracer?: RuntimeTracer;
	readonly tracingTraceName?: string;
	readonly tracingMetadata?: Readonly<Record<string, unknown>>;
	readonly agentPlugins?: AgentPluginRuntimeConfig;
	readonly invokePluginTool?: AgentPluginToolInvoker;
	readonly invokePluginContinuation?: AgentPluginContinuationInvoker;
	readonly invokePluginSystemPrompt?: AgentPluginSystemPromptInvoker;
	readonly pluginTurnHandlerLeaseProvider?: AgentPluginTurnHandlerLeaseProvider;
}

export interface CodingAgentSessionDiagnostic {
	readonly code: "extension_load_failed";
	readonly severity: "error";
	readonly source: string;
	readonly message: string;
}

export interface CreateCodingAgentSessionResult {
	readonly session: CodingAgentSession;
	readonly diagnostics: readonly CodingAgentSessionDiagnostic[];
	readonly modelFallbackMessage?: string;
}

export const CODING_AGENT_SESSION_CREATE_ERROR_CODES = {
	INVALID_ACTIVE_TOOL: "coding_agent_sdk_invalid_active_tool",
	NO_MODEL: "coding_agent_sdk_no_model",
} as const;

export type CodingAgentSessionCreateErrorCode =
	(typeof CODING_AGENT_SESSION_CREATE_ERROR_CODES)[keyof typeof CODING_AGENT_SESSION_CREATE_ERROR_CODES];

export class CodingAgentSessionCreateError extends Error {
	constructor(
		readonly code: CodingAgentSessionCreateErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "CodingAgentSessionCreateError";
	}
}
