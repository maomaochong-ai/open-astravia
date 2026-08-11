import type { AgentMessage } from "@vetta/agent-core";
import type { Api, AssistantMessage, Model } from "@vetta/ai";
import type {
	ContextCompactionRecord,
	ConversationContinuationDirective,
	TurnObserver,
} from "@vetta/runtime-core/kernel";
import type { CodingToolRegistration } from "@vetta/runtime-tools/coding";
import type { CompactionPreparation, CompactionSettings } from "../compaction/index.js";

export interface CodingAgentMemoryPromptState {
	readonly enabled: boolean;
	readonly file: string | undefined;
	readonly snapshot: string;
	readonly charLimit: number;
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
	readonly memoryCharLimit?: number;
	readonly flushMemory?: (
		input: CodingAgentMemoryFlushInput & { readonly memoryFile: string; readonly limit: number },
	) => Promise<readonly string[]>;
	readonly appendTurnJournal?: (cwd: string, message: AssistantMessage) => void;
	readonly appendRolloverJournal?: (cwd: string, summary: string) => void;
}

export interface CodingAgentMemoryRolloverRuntime extends CodingAgentMemoryCompactionPolicy, TurnObserver {
	readonly toolRegistration: CodingToolRegistration;
	readPromptMemory(): CodingAgentMemoryPromptState;
	renderPromptMemory(): string;
	flushMessages(input: CodingAgentMemoryFlushInput): Promise<number>;
	dispose(): void;
}
