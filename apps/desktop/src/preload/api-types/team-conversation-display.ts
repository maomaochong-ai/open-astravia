import type { TeamSessionSnapshot, TeamSessionStreamEvent } from "@vetta/agent-team";
import type { ContextCompositionReport, HistoryEntry, SessionExecutionMode } from "@vetta/runtime-core";
import type {
	ConversationAgentAuthorReference,
	ConversationMessageStreamEvent,
} from "@vetta/runtime-core/conversation";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";

/** One ordinary member Conversation, read from its native persisted history. */
export interface DesktopTeamMemberConversation {
	readonly memberId: string;
	readonly runtimeSessionId: string;
	readonly history: readonly HistoryEntry[];
}

/** Persisted execution evidence attached to one public Team message. */
export interface DesktopTeamToolExecutionProjection {
	readonly messageId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly args: Record<string, unknown>;
	readonly result?: RuntimeToolResult;
	readonly isError?: boolean;
	readonly startedAt?: number;
	readonly durationMs?: number;
	readonly phases?: readonly { readonly label: string; readonly atMs: number }[];
}

/** UI read model assembled by Desktop Main; never persisted or sent to Agent context. */
export interface DesktopTeamConversationDisplay {
	readonly memberConversations: readonly DesktopTeamMemberConversation[];
	/** Members with durable queued/running work, used to restore status after reopening. */
	readonly workingMemberIds?: readonly string[];
	/** Tool evidence recovered from a member publication and keyed to its public message. */
	readonly toolExecutions?: readonly DesktopTeamToolExecutionProjection[];
	readonly executionMode?: SessionExecutionMode;
	/** Context usage for every member runtime, keyed by runtime session identity. */
	readonly contextUsages?: readonly {
		readonly memberId?: string;
		readonly runtimeSessionId?: string;
		readonly percent: number | null;
		readonly contextTokens?: number | null;
		readonly contextWindow: number;
		readonly composition?: ContextCompositionReport;
	}[];
	/** @deprecated Use contextUsages. Kept for older Renderer builds. */
	readonly contextUsage?: {
		readonly memberId?: string;
		readonly runtimeSessionId?: string;
		readonly percent: number | null;
		readonly contextTokens?: number | null;
		readonly contextWindow: number;
		readonly composition?: ContextCompositionReport;
	};
}

export interface DesktopTeamContextUsageEvent {
	readonly type: "desktop.team-context-usage";
	readonly conversationId: string;
	readonly memberId: string;
	readonly runtimeSessionId: string;
	readonly contextUsage: NonNullable<DesktopTeamConversationDisplay["contextUsage"]>;
	readonly isCompacting?: boolean;
}

/** Desktop display delta adapted from a neutral Runtime execution observation. */
export interface DesktopTeamToolExecutionEvent {
	readonly type: "desktop.team-tool-execution";
	readonly conversationId: string;
	readonly messageId: string;
	readonly turnId: string;
	readonly author: ConversationAgentAuthorReference;
	readonly sequence: number;
	readonly timestamp: number;
	readonly event:
		| {
				readonly type: "start";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly args: unknown;
				readonly startedAt: number;
		  }
		| {
				readonly type: "update";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly partialResult: RuntimeToolResult;
		  }
		| {
				readonly type: "phase";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly label: string;
				readonly atMs: number;
		  }
		| {
				readonly type: "end";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly result: RuntimeToolResult;
				readonly isError: boolean;
				readonly startedAt: number;
				readonly durationMs: number;
				readonly phases: readonly { readonly label: string; readonly atMs: number }[];
		  };
}

/** Exact replay lane for an active Team turn, including Desktop-only tool observations. */
export type DesktopTeamActiveStreamEvent = ConversationMessageStreamEvent | DesktopTeamToolExecutionEvent;

/** Team snapshot enriched at the Desktop IPC boundary. */
export type DesktopTeamSessionSnapshot = TeamSessionSnapshot & {
	readonly display?: DesktopTeamConversationDisplay;
};

export type DesktopTeamSessionStreamEvent =
	| (Omit<Extract<TeamSessionStreamEvent, { type: "session-snapshot" }>, "snapshot"> & {
			readonly snapshot: DesktopTeamSessionSnapshot;
			readonly activeStreamEvents?: readonly DesktopTeamActiveStreamEvent[];
	  })
	| (Omit<Extract<TeamSessionStreamEvent, { type: "session-updated" }>, "snapshot"> & {
			readonly snapshot: DesktopTeamSessionSnapshot;
	  })
	| Exclude<TeamSessionStreamEvent, { type: "session-snapshot" | "session-updated" }>
	| DesktopTeamToolExecutionEvent
	| DesktopTeamContextUsageEvent;
