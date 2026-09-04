import type { TeamPublicationOperationRecord, TeamSessionDocument } from "@vetta/agent-team";
import type {
	ContextCompositionReport,
	ConversationDocument,
	HistoryEntry,
	SessionExecutionMode,
} from "@vetta/runtime-core";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type {
	DesktopTeamConversationDisplay,
	DesktopTeamToolExecution,
} from "../../preload/api-types/team-conversation-display.js";

export interface TeamConversationDisplaySource {
	readonly session: TeamSessionDocument;
	readonly coordination: ConversationDocument;
	readonly publications: readonly TeamPublicationOperationRecord[];
	readonly readHistory: (conversationId: string) => readonly HistoryEntry[];
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

/** Builds the Desktop UI read model without modifying Team or Runtime facts. */
export function projectTeamConversationDisplay(source: TeamConversationDisplaySource): DesktopTeamConversationDisplay {
	const publicationByMessageId = new Map(
		source.publications.flatMap((publication) =>
			publication.publicMessageEntryId ? [[publication.publicMessageEntryId, publication] as const] : [],
		),
	);
	const historyBySessionId = new Map<string, readonly HistoryEntry[]>();
	const toolExecutions: DesktopTeamToolExecution[] = [];
	for (const entry of source.coordination.entries) {
		if (entry.type !== "message" || entry.kind !== "agent") continue;
		const publication = publicationByMessageId.get(entry.id);
		if (!publication) continue;
		let history = historyBySessionId.get(publication.sourceParticipantConversationId);
		if (!history) {
			history = source.readHistory(publication.sourceParticipantConversationId);
			historyBySessionId.set(publication.sourceParticipantConversationId, history);
		}
		toolExecutions.push(...collectPublishedToolExecutions(history, publication.sourceMessageEntryId, entry.id));
	}
	return {
		toolExecutions,
		...(source.runtimeState
			? {
					executionMode: source.runtimeState.executionMode,
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

export function collectPublishedToolExecutions(
	history: readonly HistoryEntry[],
	sourceMessageEntryId: string,
	messageId: string,
): DesktopTeamToolExecution[] {
	const sourceIndex = history.findIndex((entry) => entry.type === "message" && entry.entryId === sourceMessageEntryId);
	if (sourceIndex < 0) return [];
	let startIndex = sourceIndex;
	while (startIndex > 0) {
		const previous = history[startIndex - 1];
		if (previous?.type === "message" && previous.message.role === "user") break;
		startIndex -= 1;
	}

	const executions = new Map<string, DesktopTeamToolExecution>();
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
						result: toRuntimeToolResult(entry.message),
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

function toRuntimeToolResult(message: Extract<HistoryEntry, { type: "message" }>["message"]): RuntimeToolResult {
	if (message.role !== "toolResult") throw new Error("Expected a tool result message");
	return { content: message.content, details: message.details, isError: message.isError };
}
