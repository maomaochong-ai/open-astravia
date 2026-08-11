import type { ThinkingLevel } from "@vetta/agent-core";
import type { WritePageRequest, WritePageResult } from "@vetta/runtime-knowledge";

export interface KnowledgeProcessingUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
	readonly costTotal: number;
}

export interface KnowledgeProcessingPageWriter {
	write(request: WritePageRequest, now: string): Promise<WritePageResult>;
}

export interface KnowledgeProcessingSession {
	run(prompt: string): Promise<void>;
	abort(): Promise<void>;
	subscribeUsage(listener: (usage: KnowledgeProcessingUsage) => void): () => void;
	dispose(): Promise<void>;
}

export interface KnowledgeProcessingSessionRequest {
	readonly cwd: string;
	readonly sessionDir: string;
	readonly modelKey: string;
	readonly reasoningLevel?: ThinkingLevel;
	readonly todoItems: readonly string[];
	readonly writer: KnowledgeProcessingPageWriter;
	readonly appendSystemPrompt: string;
	readonly env: Record<string, string>;
}

export interface KnowledgeProcessingSessionFactory {
	create(request: KnowledgeProcessingSessionRequest): Promise<KnowledgeProcessingSession>;
}
