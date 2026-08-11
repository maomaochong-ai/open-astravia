import type { AgentMessage, ToolPhase } from "@vetta/agent-core";
import type { ImageContent, TextContent } from "@vetta/ai";
import type { CodingAgentSessionView, CodingAgentSessionWriter } from "../sessions/index.js";

export type {
	CodingAgentBranchSummaryEntry as BranchSummaryEntry,
	CodingAgentCompactionEntry as CompactionEntry,
	CodingAgentCustomEntry as CustomEntry,
	CodingAgentCustomMessageEntry as CustomMessageEntry,
	CodingAgentLabelEntry as LabelEntry,
	CodingAgentModelChangeEntry as ModelChangeEntry,
	CodingAgentSessionContext as SessionContext,
	CodingAgentSessionEntry as SessionEntry,
	CodingAgentSessionEntryBase as SessionEntryBase,
	CodingAgentSessionHeader as SessionHeader,
	CodingAgentSessionInfoEntry as SessionInfoEntry,
	CodingAgentSessionMessageEntry as SessionMessageEntry,
	CodingAgentSessionTreeNode as SessionTreeNode,
	CodingAgentThinkingLevelEntry as ThinkingLevelChangeEntry,
	CodingAgentToolTimingEntry as ToolTimingEntry,
} from "../sessions/index.js";

export interface ExtensionSessionView extends CodingAgentSessionView {}

export interface ExtensionSessionWriter extends CodingAgentSessionWriter {
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

export type ExtensionSessionSetup = (session: ExtensionSessionWriter) => Promise<void>;
