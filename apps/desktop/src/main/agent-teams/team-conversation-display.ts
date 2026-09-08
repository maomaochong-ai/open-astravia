import type { TeamPublicationOperationRecord, TeamSessionDocument, TeamWorkItem } from "@vetta/agent-team";
import type { ContextCompositionReport, HistoryEntry, SessionExecutionMode } from "@vetta/runtime-core";
import type {
	DesktopTeamConversationDisplay,
	DesktopTeamToolExecutionProjection,
} from "../../preload/api-types/team-conversation-display.js";

export interface TeamConversationDisplaySource {
	readonly session: TeamSessionDocument;
	readonly readHistory: (runtimeSessionId: string, sessionPath: string) => Promise<readonly HistoryEntry[]>;
	readonly publications?: readonly TeamPublicationOperationRecord[];
	readonly workItems?: readonly TeamWorkItem[];
	readonly runtimeStates?: readonly {
		readonly memberId: string;
		readonly runtimeSessionId: string;
		readonly executionMode: SessionExecutionMode;
		readonly contextPercent: number | null;
		readonly contextTokens?: number | null;
		readonly contextWindow: number;
		readonly composition?: ContextCompositionReport;
	}[];
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
	const memberConversationsByRuntimeId = new Map(
		memberConversations.map((conversation) => [conversation.runtimeSessionId, conversation]),
	);
	const toolExecutions = new Map<string, DesktopTeamToolExecutionProjection>();
	for (const publication of source.publications ?? []) {
		if (!publication.publicMessageEntryId) continue;
		const memberConversation = memberConversationsByRuntimeId.get(publication.sourceParticipantConversationId);
		if (!memberConversation) continue;
		for (const execution of collectPublishedToolExecutions(
			memberConversation.history,
			publication.sourceMessageEntryId,
			publication.publicMessageEntryId,
		)) {
			toolExecutions.set(`${execution.messageId}\u0000${execution.toolCallId}`, execution);
		}
	}
	return {
		memberConversations,
		...(() => {
			const workingMemberIds = [
				...new Set(
					(source.workItems ?? [])
						.filter((item) => item.state === "queued" || item.state === "running")
						.map((item) => item.assignedToParticipantId),
				),
			];
			return workingMemberIds.length > 0 ? { workingMemberIds } : {};
		})(),
		...(toolExecutions.size > 0 ? { toolExecutions: [...toolExecutions.values()] } : {}),
		executionMode: source.runtimeStates?.[0]?.executionMode ?? source.session.executionMode ?? "full-access",
		...(source.runtimeStates && source.runtimeStates.length > 0
			? {
					contextUsages: source.runtimeStates.map((runtimeState) => ({
						memberId: runtimeState.memberId,
						runtimeSessionId: runtimeState.runtimeSessionId,
						percent: runtimeState.contextPercent,
						...(runtimeState.contextTokens === undefined ? {} : { contextTokens: runtimeState.contextTokens }),
						contextWindow: runtimeState.contextWindow,
						...(runtimeState.composition ? { composition: runtimeState.composition } : {}),
					})),
				}
			: {}),
		...(source.runtimeStates?.[0]
			? {
					contextUsage: {
						memberId: source.runtimeStates[0].memberId,
						runtimeSessionId: source.runtimeStates[0].runtimeSessionId,
						percent: source.runtimeStates[0].contextPercent,
						...(source.runtimeStates[0].contextTokens === undefined
							? {}
							: { contextTokens: source.runtimeStates[0].contextTokens }),
						contextWindow: source.runtimeStates[0].contextWindow,
						...(source.runtimeStates[0].composition ? { composition: source.runtimeStates[0].composition } : {}),
					},
				}
			: {}),
	};
}

/**
 * Publication helper shared by diagnostics and the Desktop read model. Private
 * member messages never become public rows; only execution evidence linked by
 * the durable publication record is copied onto the matching public message.
 */
export function collectPublishedToolExecutions(
	history: readonly HistoryEntry[],
	sourceMessageEntryId: string,
	messageId: string,
): DesktopTeamToolExecutionProjection[] {
	const sourceIndex = history.findIndex((entry) => entry.type === "message" && entry.entryId === sourceMessageEntryId);
	if (sourceIndex < 0) return [];
	let startIndex = sourceIndex;
	while (startIndex > 0) {
		const previous = history[startIndex - 1];
		if (previous?.type === "message" && previous.message.role === "user") break;
		startIndex -= 1;
	}
	const executions = new Map<string, DesktopTeamToolExecutionProjection>();
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
