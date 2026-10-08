import type { AgentMessage } from "@astravia/agent-core";
import type { Api, AssistantMessage, Model } from "@astravia/ai";
import type {
	ContextCompactionRecord,
	ConversationContinuationDirective,
	TurnObserver,
} from "@astravia/runtime-core/kernel";
import type { CompactionPreparation, CompactionSettings } from "../compaction/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../runtime-contracts/index.js";
import type { MemoryScope } from "./memory-scope.js";
import type { MemoryTextStorage } from "./memory-storage.js";

/** 单个作用域在会话开始时的冻结快照。 */
export interface CodingAgentMemoryScopeSnapshot {
	readonly scope: MemoryScope;
	readonly file: string;
	readonly snapshot: string;
}

/**
 * 注入系统提示词的内存状态。作用域按 `user` → `project` 排列，越靠前越通用。
 */
export interface CodingAgentMemoryPromptState {
	readonly enabled: boolean;
	readonly charLimit: number;
	readonly scopes: readonly CodingAgentMemoryScopeSnapshot[];
}

export interface CodingAgentMemoryRolloverPreparation {
	readonly preparation: CompactionPreparation;
	readonly model: Model<Api>;
	readonly apiKey: string;
	readonly signal: AbortSignal;
}

export interface CodingAgentMemoryFlushInput {
	readonly messages: readonly AgentMessage[];
	readonly model: Model<Api>;
	readonly apiKey: string;
	readonly signal: AbortSignal;
}

export interface CodingAgentMemoryCompactionPolicy {
	adjustCompactionSettings(settings: CompactionSettings, contextWindow: number): CompactionSettings;
	beforeCompaction(input: CodingAgentMemoryRolloverPreparation): Promise<void>;
	beforeContinuation(record: ContextCompactionRecord): void;
	continuationAfterCompaction(): ConversationContinuationDirective;
}

export interface CodingAgentMemoryRolloverOrchestratorOptions {
	readonly memoryFile: string;
	readonly cwd: string;
	readonly memoryStorage: MemoryTextStorage;
	readonly journalStorage: MemoryTextStorage;
	/** 用户级记忆文件与存储：跨项目/对话共享；缺省时本次会话只有 `project` 作用域。 */
	readonly userMemoryFile?: string;
	readonly userMemoryStorage?: MemoryTextStorage;
	readonly memoryCharLimit?: number;
	readonly flushMemory?: (
		input: CodingAgentMemoryFlushInput & { readonly memoryFile: string; readonly limit: number },
	) => Promise<readonly string[]>;
	readonly appendTurnJournal?: (cwd: string, message: AssistantMessage) => void;
	readonly appendRolloverJournal?: (cwd: string, summary: string) => void;
}

export interface CodingAgentMemoryRolloverRuntime extends CodingAgentMemoryCompactionPolicy, TurnObserver {
	readonly toolRegistration: CodingAgentRuntimeToolRegistration;
	readPromptMemory(): CodingAgentMemoryPromptState;
	renderPromptMemory(): string;
	flushMessages(input: CodingAgentMemoryFlushInput): Promise<number>;
	dispose(): void;
}
