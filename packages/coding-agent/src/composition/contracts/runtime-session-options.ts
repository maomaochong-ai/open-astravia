import type { Message } from "@vetta/ai";
import type {
	AgentPluginContinuationInvoker,
	AgentPluginRuntimeConfig,
	AgentPluginSystemPromptInvoker,
	AgentPluginToolInvoker,
	AgentPluginTurnHandlerLeaseProvider,
	RuntimeSessionAskUserQuestionCapability,
	SessionConfig,
	SessionExecutionMode,
} from "@vetta/runtime-core";
import type { KbWritePageOperations } from "@vetta/runtime-tools/coding";
import type {
	CodingAgentRuntimeToolRegistration,
	CodingAgentSessionToolRegistration,
} from "../../runtime-contracts/index.js";

export type CodingAgentInitialTodoLockSource = "scene";

export interface CodingAgentRuntimeSessionOptions {
	readonly sessionId: string;
	readonly cwd?: string;
	readonly model?: NonNullable<SessionConfig["model"]>;
	readonly thinkingLevel?: NonNullable<SessionConfig["thinkingLevel"]>;
	readonly agentMode?: string;
	readonly executionMode?: SessionExecutionMode;
	readonly env?: Readonly<Record<string, string>>;
	readonly enableBackgroundTasks?: boolean;
	readonly includeAgentSkills?: boolean;
	readonly agentPlugins?: AgentPluginRuntimeConfig;
	readonly invokePluginTool?: AgentPluginToolInvoker;
	readonly invokePluginContinuation?: AgentPluginContinuationInvoker;
	readonly invokePluginSystemPrompt?: AgentPluginSystemPromptInvoker;
	readonly pluginTurnHandlerLeaseProvider?: AgentPluginTurnHandlerLeaseProvider;
	readonly askUserQuestion?: RuntimeSessionAskUserQuestionCapability;
	readonly sandboxHostPath?: string;
	readonly linuxBubblewrapPath?: string;
	readonly macosSandboxExecPath?: string;
	readonly parentSessionPath?: string;
	readonly parentEntryId?: string;
	readonly memoryMode?: boolean;
	readonly memoryFile?: string;
	readonly memoryCharLimit?: number;
	/** 子 Session 内部 Profile 使用；根宿主无需设置。 */
	readonly systemPromptAddon?: string;
	/** Workflow 子 Session 的父分支只读快照。 */
	readonly forkContextMessages?: readonly Message[];
	/** Workflow 子 Session 的初始 Todo。 */
	readonly initialTodos?: readonly string[];
	/** 产品组合创建初始 Todo 后施加的锁；不会暴露可写 TodoStore 给宿主。 */
	readonly initialTodoLockSource?: CodingAgentInitialTodoLockSource;
	/** 产品会话自己的 Knowledge Writer；普通会话继续使用 Composition 默认实现。 */
	readonly knowledgePageWriter?: KbWritePageOperations;
	/** 由产品宿主校验并适配的 Session 私有工具；同名定义覆盖进程级 Extension 工具。 */
	readonly sessionTools?: readonly CodingAgentSessionToolRegistration[];
	/** 仅由产品宿主为单个 Session 注入的中立 Runtime Tool 注册。 */
	readonly sessionRuntimeTools?: readonly CodingAgentRuntimeToolRegistration[];
}
