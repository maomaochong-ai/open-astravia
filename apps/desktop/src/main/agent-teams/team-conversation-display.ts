import type { TeamSessionDocument } from "@vetta/agent-team";
import type { ContextCompositionReport, HistoryEntry, SessionExecutionMode } from "@vetta/runtime-core";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { DesktopTeamConversationDisplay } from "../../preload/api-types/team-conversation-display.js";

/** @deprecated Kept for compatibility with legacy publication diagnostics. */
export interface LegacyTeamToolExecution {
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

export interface TeamConversationDisplaySource {
	readonly session: TeamSessionDocument;
	readonly readHistory: (runtimeSessionId: string, sessionPath: string) => Promise<readonly HistoryEntry[]>;
	readonly runtimeState?: {
		readonly memberId: string;
		readonly runtimeSessionId: string;
		readonly executionMode: SessionExecutionMode;
		readonly contextPercent: number | null;
		readonly contextTokens?: number | null;
		readonly contextWindow: number;
		readonly composition?: ContextCompositionReport;
	};
}

/**
 * Reads every member as an ordinary Conversation. Team adds identity and
 * aggregation only; message content remains the native persisted history.
 */
export async function projectTeamConversationDisplay(
	source: TeamConversationDisplaySource,
): Promise<DesktopTeamConversationDisplay> {
	const memberConversations = await Promise.all(
		Object.entries(source.session.memberRuntime).map(async ([memberId, runtime]) => ({
			memberId,
			runtimeSessionId: runtime.sessionId,
			history: await source.readHistory(runtime.sessionId, runtime.sessionPath),
		})),
	);
	return {
		memberConversations,
		executionMode: source.runtimeState?.executionMode ?? source.session.executionMode ?? "full-access",
		...(source.runtimeState
			? {
					contextUsage: {
						memberId: source.runtimeState.memberId,
						runtimeSessionId: source.runtimeState.runtimeSessionId,
						percent: source.runtimeState.contextPercent,
						...(source.runtimeState.contextTokens === undefined
							? {}
							: { contextTokens: source.runtimeState.contextTokens }),
						contextWindow: source.runtimeState.contextWindow,
						...(source.runtimeState.composition ? { composition: source.runtimeState.composition } : {}),
					},
				}
			: {}),
	};
}

/**
 * Legacy publication helper. It is intentionally outside the display model;
 * current Team rendering consumes each member's complete native history.
 */
export function collectPublishedToolExecutions(
	history: readonly HistoryEntry[],
	sourceMessageEntryId: string,
	messageId: string,
): LegacyTeamToolExecution[] {
	const sourceIndex = history.findIndex((entry) => entry.type === "message" && entry.entryId === sourceMessageEntryId);
	if (sourceIndex < 0) return [];
	let startIndex = sourceIndex;
	while (startIndex > 0) {
		const previous = history[startIndex - 1];
		if (previous?.type === "message" && previous.message.role === "user") break;
		startIndex -= 1;
	}
	const executions = new Map<string, LegacyTeamToolExecution>();
	for (const entry of history.slice(startIndex, sourceIndex + 1)) {
		if (entry.type === "message") {
			if (entry.message.role === "assistant") {
				for (const part of entry.message.content) {
					if (part.type !== "toolCall" || !part.id || !part.name) continue;
					executions.set(part.id, {
						messageId,
						toolCallId: part.id,
						toolName: part.name,
						args: isRecord(part.arguments) ? part.arguments : {},
					});
				}
			} else if (entry.message.role === "toolResult") {
				const current = executions.get(entry.message.toolCallId);
				if (current) {
					executions.set(entry.message.toolCallId, {
						...current,
						result: {
							content: entry.message.content,
							details: entry.message.details,
							isError: entry.message.isError,
						},
						isError: entry.message.isError,
					});
				}
			}
			continue;
		}
		if (entry.type === "tool_timing") {
			const current = executions.get(entry.toolCallId);
			if (current) {
				executions.set(entry.toolCallId, {
					...current,
					startedAt: entry.startedAt,
					durationMs: entry.durationMs,
					phases: entry.phases.map((phase) => ({ label: phase.label, atMs: phase.atMs })),
				});
			}
		}
	}
	return [...executions.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
