import type { AgentMessage, ThinkingLevel } from "@vetta/agent-core";
import type { Api, Model } from "@vetta/ai";
import type {
	AgentPluginRuntimeConfig,
	BackgroundTaskInfo,
	PromptRequest,
	RuntimeContextCompactionResult,
	RuntimeSessionContextUsage,
	RuntimeSessionExecutionObservation,
	RuntimeSessionInputQueueMode,
	RuntimeSessionState,
	RuntimeSubagentSnapshot,
	TodoItem,
} from "@vetta/runtime-core";
import type {
	CodingAgentRetryEvent,
	CodingAgentSessionEventListener,
} from "../../public-api/sdk/sdk-event-contract.js";
import type { CodingAgentPromptOptions } from "../../public-api/sdk/sdk-prompt-contract.js";
import type {
	CodingAgentActiveSessionCapabilities,
	CodingAgentBashOperations,
	CodingAgentBashResult,
	CodingAgentFixedSession,
	CodingAgentMemoryConfiguration,
	CodingAgentModelCycleResult,
	CodingAgentNewSessionOptions,
	CodingAgentPromptTemplate,
	CodingAgentScopedModel,
	CodingAgentSession,
	CodingAgentSessionStats,
	CodingAgentSkillInfo,
	CodingAgentToolInfo,
	CodingAgentTreeNavigationOptions,
	CodingAgentTreeNavigationResult,
} from "../../public-api/sdk/sdk-session-contract.js";
import type { CodingAgentSessionToolDefinition } from "../../public-api/sdk/sdk-tool-contract.js";

export type GreenfieldSdkPromptOptions = CodingAgentPromptOptions;
export type GreenfieldSdkSessionEventListener = CodingAgentSessionEventListener;
export type GreenfieldSdkCustomToolDefinition = CodingAgentSessionToolDefinition;
export type GreenfieldSdkScopedModel = CodingAgentScopedModel;
export type GreenfieldSdkModelCycleResult = CodingAgentModelCycleResult;
export type GreenfieldSdkToolInfo = CodingAgentToolInfo;
export type GreenfieldSdkPromptTemplate = CodingAgentPromptTemplate;
export type GreenfieldSdkMemoryConfiguration = CodingAgentMemoryConfiguration;
export type GreenfieldSdkSessionStats = CodingAgentSessionStats;
export type GreenfieldSdkSkillInfo = CodingAgentSkillInfo;
export type GreenfieldSdkRetryEvent = CodingAgentRetryEvent;
export type GreenfieldSdkSession = CodingAgentFixedSession;
export type GreenfieldSdkBashOperations = CodingAgentBashOperations;
export type GreenfieldSdkBashResult = CodingAgentBashResult;
export type GreenfieldSdkNewSessionOptions = CodingAgentNewSessionOptions;
export type GreenfieldSdkTreeNavigationOptions = CodingAgentTreeNavigationOptions;
export type GreenfieldSdkTreeNavigationResult = CodingAgentTreeNavigationResult;
export type GreenfieldSdkActiveSession = CodingAgentSession;

/** 固定会话适配器依赖的内部能力端口。 */
export interface GreenfieldSdkSessionCapabilityPort {
	prompt(request: PromptRequest): Promise<unknown>;
	selectModel(provider: string, modelId: string): Promise<Model<Api> | undefined>;
	setThinkingLevel(level: ThinkingLevel): void;
	subscribeRetryEvents(handler: (event: CodingAgentRetryEvent) => void): () => void;
	readRetryAttempt(): number;
	readActiveToolNames(): readonly string[];
	readAllTools(): readonly CodingAgentToolInfo[];
	setActiveToolNames(toolNames: readonly string[]): void;
	reconfigureCustomTools(customTools: readonly CodingAgentSessionToolDefinition[] | undefined): void;
	readAgentMode(): string | undefined;
	setAgentMode(mode: string | undefined): void;
	readIsCompacting(): boolean;
	readSteeringMode(): RuntimeSessionInputQueueMode;
	readFollowUpMode(): RuntimeSessionInputQueueMode;
	readSessionName(): string | undefined;
	readScopedModels(): readonly CodingAgentScopedModel[];
	setScopedModels(scopedModels: readonly CodingAgentScopedModel[]): void;
	clearQueue(): { readonly steering: readonly string[]; readonly followUp: readonly string[] };
	readPendingMessageCount(): number;
	readSteeringMessages(): readonly string[];
	readFollowUpMessages(): readonly string[];
	cycleModel(direction?: "forward" | "backward"): Promise<CodingAgentModelCycleResult | undefined>;
	cycleThinkingLevel(): ThinkingLevel | undefined;
	readAvailableThinkingLevels(): readonly ThinkingLevel[];
	supportsXhighThinking(): boolean;
	supportsThinking(): boolean;
	setSteeringMode(mode: RuntimeSessionInputQueueMode): void;
	setFollowUpMode(mode: RuntimeSessionInputQueueMode): void;
	compact(customInstructions?: string, signal?: AbortSignal): Promise<RuntimeContextCompactionResult>;
	abortCompaction(): void;
	setAutoCompactionEnabled(enabled: boolean): void;
	readAutoCompactionEnabled(): boolean;
	abortRetry(): void;
	readIsRetrying(): boolean;
	readAutoRetryEnabled(): boolean;
	setAutoRetryEnabled(enabled: boolean): void;
	setSessionName(name: string): Promise<void>;
	readSessionStats(): CodingAgentSessionStats;
	readContextUsage(): RuntimeSessionContextUsage | undefined;
	readLastAssistantText(): string | undefined;
	readSubagents(): readonly RuntimeSubagentSnapshot[];
	interruptSubagent(target: string): RuntimeSubagentSnapshot | undefined;
	clearFinishedSubagents(): number;
	readAvailableModels(): Promise<readonly Model<Api>[]>;
	readSystemPrompt(): string;
	readSkills(): readonly CodingAgentSkillInfo[];
	readPromptTemplates(): readonly CodingAgentPromptTemplate[];
	reconfigureAgentPlugins(agentPlugins: AgentPluginRuntimeConfig | undefined): Promise<void>;
	readBackgroundTasks(): readonly BackgroundTaskInfo[];
	killBackgroundTask(taskId: string): boolean;
	clearFinishedBackgroundTasks(): number;
	readTodos(): readonly TodoItem[];
	clearTodos(): boolean;
	readMemoryConfiguration(): CodingAgentMemoryConfiguration;
	flushMemory(signal?: AbortSignal): Promise<number>;
	reloadMcp(): Promise<void>;
	reload(): Promise<void>;
	exportToHtml(outputPath?: string): Promise<string>;
	hasExtensionHandlers(eventType: string): boolean;
}

/** 活动会话适配器依赖的内部身份与历史端口。 */
export interface GreenfieldSdkActiveSessionCapabilityPort extends CodingAgentActiveSessionCapabilities {
	quiesceIdentity(): Promise<void>;
	dispose(): Promise<void>;
}

/** 内部适配器依赖的最小 Runtime 会话端口。 */
export interface GreenfieldSdkSessionRuntimePort {
	readonly sessionId: string;
	readonly sessionPath: string | undefined;
	readonly capabilities: GreenfieldSdkSessionCapabilityPort;
	prompt(request: PromptRequest): Promise<unknown>;
	abort(reason?: string): Promise<void>;
	readState(): RuntimeSessionState;
	readMessages(): readonly AgentMessage[];
	selectModel(modelKey: string): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): void;
	subscribeExecutionObservation(
		handler: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
	): () => void;
	dispose(): Promise<void>;
}
