import type { AgentMessage, ThinkingLevel } from "@vetta/agent-core";
import type { Api, ImageContent, Model, TextContent } from "@vetta/ai";
import type {
	AgentPluginRuntimeConfig,
	BackgroundTaskInfo,
	RuntimeContextCompactionResult,
	RuntimeSessionContextUsage,
	RuntimeSessionInputQueueMode,
	RuntimeSessionState,
	RuntimeSubagentSnapshot,
	TodoItem,
} from "@vetta/runtime-core";
import type { CodingAgentSessionEventListener } from "./sdk-event-contract.js";
import type { CodingAgentPromptOptions } from "./sdk-prompt-contract.js";
import type { CodingAgentSkillContribution } from "./sdk-resource-source-contract.js";
import type { CodingAgentSessionToolDefinition } from "./sdk-tool-contract.js";

export interface CodingAgentScopedModel {
	readonly model: Model<Api>;
	readonly thinkingLevel: ThinkingLevel;
}

export interface CodingAgentModelCycleResult extends CodingAgentScopedModel {
	readonly isScoped: boolean;
}

export interface CodingAgentToolInfo {
	readonly name: string;
	readonly description: string;
	readonly parameters: unknown;
}

/** Prompt 模板的只读 SDK 投影；不暴露资源加载实现。 */
export interface CodingAgentPromptTemplate {
	readonly name: string;
	readonly description: string;
	readonly content: string;
	readonly source: string;
	readonly filePath: string;
}

/** 当前 Session 可见 Skill 的只读投影。 */
export type CodingAgentSkillInfo = Omit<CodingAgentSkillContribution, "content" | "filePath" | "baseDir"> & {
	readonly source: string;
};

/** Memory 的当前配置视图；写入和压缩实现仍由产品 Runtime 拥有。 */
export interface CodingAgentMemoryConfiguration {
	readonly enabled: boolean;
	readonly file: string | undefined;
	readonly charLimit: number;
}

export interface CodingAgentSessionStats {
	readonly sessionFile: string | undefined;
	readonly sessionId: string;
	readonly userMessages: number;
	readonly assistantMessages: number;
	readonly toolCalls: number;
	readonly toolResults: number;
	readonly totalMessages: number;
	readonly tokens: {
		readonly input: number;
		readonly output: number;
		readonly cacheRead: number;
		readonly cacheWrite: number;
		readonly total: number;
	};
	readonly cost: number;
}

/** 稳定公共 SDK 的核心会话合同。 */
export interface CodingAgentSessionCore {
	readonly sessionId: string;
	readonly sessionFile: string | undefined;
	readonly state: RuntimeSessionState;
	readonly model: Model<Api> | undefined;
	readonly thinkingLevel: ThinkingLevel;
	readonly isStreaming: boolean;
	readonly messages: readonly AgentMessage[];
	prompt(text: string, options?: CodingAgentPromptOptions): Promise<void>;
	steer(text: string, images?: CodingAgentPromptOptions["images"]): Promise<void>;
	followUp(text: string, images?: CodingAgentPromptOptions["images"]): Promise<void>;
	abort(): Promise<void>;
	setModel(model: Model<Api>): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): void;
	subscribe(listener: CodingAgentSessionEventListener): () => void;
	dispose(): void;
	close(): Promise<void>;
}

/** 叠加在核心会话之上的产品能力，不暴露具体管理器。 */
export interface CodingAgentSessionCapabilities {
	readonly retryAttempt: number;
	readonly agentMode: string | undefined;
	readonly isCompacting: boolean;
	readonly steeringMode: RuntimeSessionInputQueueMode;
	readonly followUpMode: RuntimeSessionInputQueueMode;
	readonly sessionName: string | undefined;
	readonly scopedModels: readonly CodingAgentScopedModel[];
	readonly pendingMessageCount: number;
	readonly autoCompactionEnabled: boolean;
	readonly isRetrying: boolean;
	readonly autoRetryEnabled: boolean;
	getActiveToolNames(): readonly string[];
	getAllTools(): readonly CodingAgentToolInfo[];
	setActiveToolsByName(toolNames: readonly string[]): void;
	reconfigureCustomTools(customTools: readonly CodingAgentSessionToolDefinition[] | undefined): void;
	setAgentMode(mode: string | undefined): void;
	setScopedModels(scopedModels: readonly CodingAgentScopedModel[]): void;
	clearQueue(): { readonly steering: readonly string[]; readonly followUp: readonly string[] };
	getSteeringMessages(): readonly string[];
	getFollowUpMessages(): readonly string[];
	cycleModel(direction?: "forward" | "backward"): Promise<CodingAgentModelCycleResult | undefined>;
	cycleThinkingLevel(): ThinkingLevel | undefined;
	getAvailableThinkingLevels(): readonly ThinkingLevel[];
	supportsXhighThinking(): boolean;
	supportsThinking(): boolean;
	setSteeringMode(mode: RuntimeSessionInputQueueMode): void;
	setFollowUpMode(mode: RuntimeSessionInputQueueMode): void;
	compact(customInstructions?: string, signal?: AbortSignal): Promise<RuntimeContextCompactionResult>;
	abortCompaction(): void;
	setAutoCompactionEnabled(enabled: boolean): void;
	abortRetry(): void;
	setAutoRetryEnabled(enabled: boolean): void;
	setSessionName(name: string): Promise<void>;
	getSessionStats(): CodingAgentSessionStats;
	getContextUsage(): RuntimeSessionContextUsage | undefined;
	getLastAssistantText(): string | undefined;
	listSubagents(): readonly RuntimeSubagentSnapshot[];
	interruptSubagent(target: string): RuntimeSubagentSnapshot | undefined;
	clearFinishedSubagents(): number;
	listAvailableModels(): Promise<readonly Model<Api>[]>;
	getSystemPrompt(): string;
	getSkills(): readonly CodingAgentSkillInfo[];
	getPromptTemplates(): readonly CodingAgentPromptTemplate[];
	reconfigureAgentPlugins(agentPlugins: AgentPluginRuntimeConfig | undefined): Promise<void>;
	listBackgroundTasks(): readonly BackgroundTaskInfo[];
	killBackgroundTask(taskId: string): boolean;
	clearFinishedBackgroundTasks(): number;
	getTodos(): readonly TodoItem[];
	clearTodos(): boolean;
	getMemoryConfiguration(): CodingAgentMemoryConfiguration;
	flushMemory(signal?: AbortSignal): Promise<number>;
	reloadMcp(): Promise<void>;
	reload(): Promise<void>;
	exportToHtml(outputPath?: string): Promise<string>;
	hasExtensionHandlers(eventType: string): boolean;
}

export type CodingAgentFixedSession = CodingAgentSessionCore & CodingAgentSessionCapabilities;

export interface CodingAgentSessionSetup {
	appendMessage(message: AgentMessage): string;
}

export interface CodingAgentBashOperations {
	exec(
		command: string,
		cwd: string,
		options: {
			readonly onData: (data: Buffer) => void;
			readonly signal?: AbortSignal;
			readonly timeout?: number;
			readonly env?: NodeJS.ProcessEnv;
		},
	): Promise<{ readonly exitCode: number | null }>;
}

export interface CodingAgentBashResult {
	readonly output: string;
	readonly exitCode: number | undefined;
	readonly cancelled: boolean;
	readonly truncated: boolean;
	readonly fullOutputPath?: string;
}

export interface CodingAgentSessionBranchEntry {
	readonly id: string;
	readonly type: string;
	readonly parentId: string | null;
}

export interface CodingAgentBranchSummaryEntry extends CodingAgentSessionBranchEntry {
	readonly type: "branch_summary";
	readonly summary: string;
}

export interface CodingAgentNewSessionOptions {
	readonly parentSession?: string;
	readonly setup?: (session: CodingAgentSessionSetup) => Promise<void>;
}

export interface CodingAgentTreeNavigationOptions {
	readonly summarize?: boolean;
	readonly customInstructions?: string;
	readonly replaceInstructions?: boolean;
	readonly label?: string;
}

export interface CodingAgentTreeNavigationResult {
	readonly editorText?: string;
	readonly cancelled: boolean;
	readonly aborted?: boolean;
	readonly summaryEntry?: CodingAgentBranchSummaryEntry;
}

/** 会改变当前会话身份或依赖活动会话所有权的稳定 SDK 操作。 */
export interface CodingAgentActiveSessionCapabilities {
	getSessionBranch(): readonly CodingAgentSessionBranchEntry[];
	sendCustomMessage<T = unknown>(
		message: {
			readonly customType: string;
			readonly content: string | readonly (TextContent | ImageContent)[];
			readonly display: boolean;
			readonly details?: T;
		},
		options?: { readonly triggerTurn?: boolean; readonly deliverAs?: "steer" | "followUp" | "nextTurn" },
	): Promise<void>;
	sendUserMessage(
		content: string | readonly (TextContent | ImageContent)[],
		options?: { readonly deliverAs?: "steer" | "followUp" },
	): Promise<void>;
	newSession(options?: CodingAgentNewSessionOptions): Promise<boolean>;
	abortBranchSummary(): void;
	executeBash(
		command: string,
		onChunk?: (chunk: string) => void,
		options?: { readonly excludeFromContext?: boolean; readonly operations?: CodingAgentBashOperations },
	): Promise<CodingAgentBashResult>;
	recordBashResult(
		command: string,
		result: CodingAgentBashResult,
		options?: { readonly excludeFromContext?: boolean },
	): Promise<void>;
	abortBash(): void;
	readonly isBashRunning: boolean;
	readonly hasPendingBashMessages: boolean;
	switchSession(sessionPath: string): Promise<boolean>;
	fork(entryId: string): Promise<{ readonly selectedText: string; readonly cancelled: boolean }>;
	navigateTree(targetId: string, options?: CodingAgentTreeNavigationOptions): Promise<CodingAgentTreeNavigationResult>;
	switchBranch(targetId: string): Promise<{ readonly leafId: string }>;
	appendBranchSummary(
		parentId: string | null,
		summary: string,
		details?: unknown,
		fromHook?: boolean,
	): Promise<{ readonly entryId: string }>;
	deleteMessage(entryId: string): Promise<{ readonly leafId: string | null }>;
	replaceLastUserMessage(entryId: string): Promise<{ readonly leafId: string | null }>;
	exportForkToNewFile(entryId: string): Promise<{ readonly path: string; readonly text: string }>;
	getUserMessagesForForking(): readonly { readonly entryId: string; readonly text: string }[];
}

/** `@vetta/coding-agent/sdk` 返回的稳定活动会话门面。 */
export type CodingAgentSession = CodingAgentFixedSession & CodingAgentActiveSessionCapabilities;
