import type { AgentMessage, ToolPhase } from "@vetta/agent-core";
import type { ImageContent, TextContent } from "@vetta/ai";
import type { CodingAgentSessionEntry, CodingAgentSessionHeader, CodingAgentSessionTreeNode } from "./session-entry.js";

export interface CodingAgentSessionView {
	getCwd(): string;
	getSessionDir(): string;
	getSessionId(): string;
	getSessionFile(): string | undefined;
	getLeafId(): string | null;
	getLeafEntry(): CodingAgentSessionEntry | undefined;
	getEntry(id: string): CodingAgentSessionEntry | undefined;
	getLabel(id: string): string | undefined;
	getBranch(fromId?: string): CodingAgentSessionEntry[];
	getHeader(): CodingAgentSessionHeader | null;
	getEntries(): CodingAgentSessionEntry[];
	getTree(): CodingAgentSessionTreeNode[];
	getSessionName(): string | undefined;
}

export interface CodingAgentSessionWriter extends CodingAgentSessionView {
	appendMessage(message: AgentMessage): string;
	appendThinkingLevelChange(thinkingLevel: string): string;
	appendToolTiming(
		toolCallId: string,
		toolName: string,
		startedAt: number,
		durationMs: number,
		phases: ToolPhase[],
	): string;
	appendModelChange(provider: string, modelId: string): string;
	appendCompaction<T = unknown>(
		summary: string,
		firstKeptEntryId: string,
		tokensBefore: number,
		details?: T,
		fromHook?: boolean,
	): string;
	appendCustomEntry(customType: string, data?: unknown): string;
	appendSessionInfo(name: string): string;
	appendCustomMessageEntry<T = unknown>(
		customType: string,
		content: string | (TextContent | ImageContent)[],
		display: boolean,
		details?: T,
	): string;
	branch(branchFromId: string): void;
	resetLeaf(): void;
	branchWithSummary(branchFromId: string | null, summary: string, details?: unknown, fromHook?: boolean): string;
	appendLabelChange(targetId: string, label: string | undefined): string;
}
