import type { EcosystemHookAdapterFactory, HookConfigLayer } from "@vetta/ecosystem-adapter";
import type { ConversationScenario, SessionConfig } from "@vetta/runtime-core";
import type { AgentCoreTurnEngineOptions } from "@vetta/runtime-core/kernel";
import type { McpRuntimeToolSource } from "@vetta/runtime-mcp";
import type { ConversationOwnershipManager } from "@vetta/runtime-storage/conversation";
import type { SubagentTypeRegistryLike } from "@vetta/runtime-subagents";
import type { CodingToolActivation } from "@vetta/runtime-tools/coding";
import type {
	CodingAgentMemoryRolloverOrchestratorOptions,
	CodingAgentMemoryRolloverRuntime,
} from "../../memory/index.js";
import type {
	CodingAgentCompactionExtensionRuntime,
	CodingAgentCompactionRuntimeOptions,
	CodingAgentExtensionToolSource,
	CodingAgentPluginMcpRuntime,
	CodingAgentPluginRuntimeSource,
	CodingAgentPromptResourceResolver,
	CodingAgentPromptResourceSource,
	CodingAgentPromptSettingsSource,
	CodingAgentRuntimeModelSource,
	CodingAgentSystemPromptOptionsResolver,
} from "../../runtime-contracts/index.js";
import type { CodingAgentTodoRuntime } from "../../work-state/contracts.js";
import type { CodingAgentConversationPersistenceFactory } from "./conversation-persistence.js";
import type { CodingAgentRuntimeSessionOptions } from "./runtime-session-options.js";
import type {
	CodingAgentSubagentChildFactory,
	CodingAgentSubagentChildFactoryContext,
	CodingAgentSubagentProfile,
} from "./subagent.js";

export interface CodingAgentRuntimeEnvironmentOptions {
	readonly cwd?: string;
	readonly agentDir?: string;
	readonly scenario?: ConversationScenario;
}

export interface CodingAgentRuntimeConversationOptions {
	/** 默认文件仓储根目录；注入 createConversationPersistence 时只作为工厂上下文。 */
	readonly conversationDir: string;
	/** 为每个 Composition 创建独占持久化端口；Composition 负责关闭。 */
	readonly createConversationPersistence?: CodingAgentConversationPersistenceFactory;
	/** 可选的进程级会话所有权；与 Repository 单次写锁相互独立。 */
	readonly conversationOwnershipManager?: ConversationOwnershipManager;
}

export interface CodingAgentRuntimeModelOptions {
	readonly modelRegistry: CodingAgentRuntimeModelSource;
	readonly initialModel: NonNullable<SessionConfig["model"]>;
	readonly initialThinkingLevel: NonNullable<SessionConfig["thinkingLevel"]>;
	readonly streamFn?: AgentCoreTurnEngineOptions["streamFn"];
}

export interface CodingAgentRuntimeToolOptions {
	readonly activation?: CodingToolActivation;
	readonly knowledgeEnabled?: boolean;
	readonly knowledgeRoot?: string;
	/** 仅用于保留宿主既有系统提示词合同；不会把名称对应的工具加入可执行 Tool Frame。 */
	readonly systemPromptAdvertisedToolNames?: readonly string[];
	readonly mcpSource?: McpRuntimeToolSource;
	readonly tokenBudget?: number;
	readonly reservedOutputTokens?: number;
}

export interface CodingAgentRuntimeSubagentOptions {
	/** 仅 Root Profile 启用；子 Session 必须显式关闭，保持单层委派。 */
	readonly enableSubagents?: boolean;
	readonly subagentMaxConcurrent?: number;
	/** 运行时实时读取的子代理类型注册表；注册变化影响后续 spawn，不重建当前 Session。 */
	readonly subagentTypeRegistry?: SubagentTypeRegistryLike<CodingAgentSubagentProfile>;
	/** 子代理 Child 创建的产品边界；未提供时使用 Coding Agent Child Composition。 */
	readonly createSubagentChildFactory?: (
		context: CodingAgentSubagentChildFactoryContext,
	) => CodingAgentSubagentChildFactory;
}

export interface CodingAgentRuntimePromptOptions {
	/** 已由宿主 Bootstrap 加载的共享动态资源；必须与 promptSettingsSource 同时提供。 */
	readonly promptResourceSource?: CodingAgentPromptResourceSource;
	/** 已由宿主 Bootstrap 加载的共享设置；必须与 promptResourceSource 同时提供。 */
	readonly promptSettingsSource?: CodingAgentPromptSettingsSource;
	/** 优先使用会话工厂，避免有状态 ResourceLoader / TodoStore 被多个 Session 共享。 */
	readonly createPromptResourceResolver?: (
		sessionOptions: CodingAgentRuntimeSessionOptions,
		todoRuntime: CodingAgentTodoRuntime,
	) => CodingAgentPromptResourceResolver;
	/** 无状态解析器的兼容入口。 */
	readonly resolvePromptResource?: CodingAgentPromptResourceResolver;
	/** 为每个 Session 创建调用级系统提示词来源。 */
	readonly createSystemPromptOptionsResolver?: (
		sessionOptions: CodingAgentRuntimeSessionOptions,
	) => CodingAgentSystemPromptOptionsResolver;
	/** 无状态系统提示词来源的兼容入口。 */
	readonly resolveSystemPromptOptions?: CodingAgentSystemPromptOptionsResolver;
}

export interface CodingAgentRuntimePluginOptions {
	/** 为每个 Session 绑定动态 Plugin Provider 与 Continuation bridge。 */
	readonly createPluginRuntime?: (
		sessionOptions: CodingAgentRuntimeSessionOptions,
	) => CodingAgentPluginRuntimeSource | undefined;
	/** 为每个 Session 创建仅承载插件动态 Server 的 MCP Runtime；不得复用共享文件 MCP Source。 */
	readonly createPluginMcpRuntime?: (context: {
		readonly cwd: string;
		readonly agentDir?: string;
		readonly sessionOptions: CodingAgentRuntimeSessionOptions;
	}) => Promise<CodingAgentPluginMcpRuntime>;
}

export interface CodingAgentRuntimeExtensionOptions {
	/** 已由宿主加载的 Extension Tool 注册；只在 Coding Agent 调用级 Frame 中物化。 */
	readonly extensionTools?: readonly CodingAgentExtensionToolSource[];
	/** 追加到每个 Session 内置 Codex/Claude Hook Adapter 之后。 */
	readonly additionalHookAdapterFactories?: readonly EcosystemHookAdapterFactory[];
	/** 显式 Hook 配置层；未提供时由内置 Adapter 使用各自默认发现规则。 */
	readonly hookConfigLayers?: readonly HookConfigLayer[];
	readonly maxStopHookContinuations?: number;
}

export interface CodingAgentRuntimeContextOptions {
	/** 为每个 Session 创建唯一 Todo Runtime；Tool、Continuation、Scene 与 Controller 共享它。 */
	readonly createTodoRuntime?: (sessionOptions: CodingAgentRuntimeSessionOptions) => CodingAgentTodoRuntime;
	/** 运行中读取压缩设置；未提供时使用 Coding Agent 既有默认值。 */
	readonly resolveCompactionSettings?: CodingAgentCompactionRuntimeOptions["resolveSettings"];
	/** 为每个 Session 创建 Extension 压缩事件的窄适配器。 */
	readonly createCompactionExtensionRuntime?: (
		sessionOptions: CodingAgentRuntimeSessionOptions,
	) => CodingAgentCompactionExtensionRuntime | undefined;
	/** 测试或宿主可替换摘要调用；生产默认复用 Coding Agent 既有实现。 */
	readonly generateCompaction?: CodingAgentCompactionRuntimeOptions["generateCompaction"];
	/** 为每个 memory-mode Session 创建产品级 Memory Runtime；默认使用 Coding Agent 既有实现。 */
	readonly createMemoryRolloverRuntime?: (
		options: CodingAgentMemoryRolloverOrchestratorOptions,
		sessionOptions: CodingAgentRuntimeSessionOptions,
	) => CodingAgentMemoryRolloverRuntime;
}

export interface CodingAgentRuntimeObservabilityOptions {
	/** 平台中立的进程级观测端口；Composition 与 Runtime 均不拥有其生命周期。 */
	readonly tracer?: AgentCoreTurnEngineOptions["tracer"];
	/** Session 间共享的观测策略；Turn Engine 会覆盖真实 Session 身份。 */
	readonly tracing?: AgentCoreTurnEngineOptions["tracing"];
}

export interface CodingAgentRuntimeCompositionOptions
	extends CodingAgentRuntimeEnvironmentOptions,
		CodingAgentRuntimeConversationOptions,
		CodingAgentRuntimeModelOptions,
		CodingAgentRuntimeToolOptions,
		CodingAgentRuntimeSubagentOptions,
		CodingAgentRuntimePromptOptions,
		CodingAgentRuntimePluginOptions,
		CodingAgentRuntimeExtensionOptions,
		CodingAgentRuntimeContextOptions,
		CodingAgentRuntimeObservabilityOptions {}
