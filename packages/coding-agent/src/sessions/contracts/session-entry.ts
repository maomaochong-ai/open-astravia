import type { AgentMessage, ToolPhase } from "@vetta/agent-core";
import type { ImageContent, TextContent } from "@vetta/ai";

/** Extension-facing compatibility version; native persistence has its own schema version. */
export const CODING_AGENT_SESSION_VIEW_VERSION = 3;

export interface CodingAgentSessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

export interface CodingAgentSessionMessageEntry extends CodingAgentSessionEntryBase {
	type: "message";
	message: AgentMessage;
}

export interface CodingAgentThinkingLevelEntry extends CodingAgentSessionEntryBase {
	type: "thinking_level_change";
	thinkingLevel: string;
}

export interface CodingAgentModelChangeEntry extends CodingAgentSessionEntryBase {
	type: "model_change";
	provider: string;
	modelId: string;
}

export interface CodingAgentCompactionEntry<T = unknown> extends CodingAgentSessionEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: T;
	fromHook?: boolean;
}

export interface CodingAgentBranchSummaryEntry<T = unknown> extends CodingAgentSessionEntryBase {
	type: "branch_summary";
	fromId: string;
	summary: string;
	details?: T;
	fromHook?: boolean;
}

export interface CodingAgentCustomEntry<T = unknown> extends CodingAgentSessionEntryBase {
	type: "custom";
	customType: string;
	data?: T;
}

export interface CodingAgentCustomMessageEntry<T = unknown> extends CodingAgentSessionEntryBase {
	type: "custom_message";
	customType: string;
	content: string | (TextContent | ImageContent)[];
	details?: T;
	display: boolean;
}

export interface CodingAgentLabelEntry extends CodingAgentSessionEntryBase {
	type: "label";
	targetId: string;
	label: string | undefined;
}

export interface CodingAgentSessionInfoEntry extends CodingAgentSessionEntryBase {
	type: "session_info";
	name?: string;
}

export interface CodingAgentToolTimingEntry extends CodingAgentSessionEntryBase {
	type: "tool_timing";
	toolCallId: string;
	toolName: string;
	startedAt: number;
	durationMs: number;
	phases: ToolPhase[];
}

export type CodingAgentSessionEntry =
	| CodingAgentSessionMessageEntry
	| CodingAgentThinkingLevelEntry
	| CodingAgentModelChangeEntry
	| CodingAgentCompactionEntry
	| CodingAgentBranchSummaryEntry
	| CodingAgentCustomEntry
	| CodingAgentCustomMessageEntry
	| CodingAgentLabelEntry
	| CodingAgentSessionInfoEntry
	| CodingAgentToolTimingEntry;

export interface CodingAgentSessionHeader {
	type: "session";
	version?: number;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
	parentEntryId?: string;
}

export interface CodingAgentSessionTreeNode {
	entry: CodingAgentSessionEntry;
	children: CodingAgentSessionTreeNode[];
	label?: string;
}

export interface CodingAgentSessionContext {
	messages: AgentMessage[];
	thinkingLevel: string;
	model: { provider: string; modelId: string } | null;
}
