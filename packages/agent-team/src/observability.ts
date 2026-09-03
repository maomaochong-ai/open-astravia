import type { RuntimeSessionExecutionObservation } from "@vetta/runtime-core";
import {
	defineRuntimeObservation,
	type RuntimeObservationFailure,
	type RuntimeObservationPublisher,
} from "@vetta/runtime-core/observation";

export interface TeamObservationCorrelation {
	readonly teamId: string;
	readonly coordinationConversationId: string;
	readonly participantId?: string;
	readonly workItemId?: string;
	readonly attemptId?: string;
	readonly deliveryId?: string;
	readonly requestTurnId?: string;
	readonly sourceTurnId?: string;
	readonly resultMessageId?: string;
	readonly toolCallId?: string;
}

export interface TeamLifecycleObservation extends TeamObservationCorrelation {
	readonly phase: "create" | "restore" | "reconfigure" | "dispose";
	readonly teamRevision: number;
	readonly memberCount: number;
	readonly failure?: RuntimeObservationFailure;
}

export interface TeamRoutingObservation extends TeamObservationCorrelation {
	readonly phase: "resolved" | "scheduled" | "rejected";
	readonly targetParticipantIds: readonly string[];
	readonly policyId: string;
	readonly reasonCode?: string;
}

export interface TeamContextObservation extends TeamObservationCorrelation {
	readonly phase: "planned" | "delivered" | "skipped" | "failed";
	readonly projectionPolicyId: string;
	readonly generationId: string;
	readonly throughConversationRevision: number;
	readonly entryCount: number;
	readonly checkpointId?: string;
	readonly sourceFingerprint: string;
	readonly failure?: RuntimeObservationFailure;
}

export interface TeamSharedContextSummaryObservation extends TeamObservationCorrelation {
	readonly phase: "started" | "completed" | "reused" | "failed";
	readonly projectionPolicyId: string;
	readonly sourceEntryCount: number;
	readonly summarizedEntryCount: number;
	readonly retainedEntryCount: number;
	readonly checkpointId?: string;
	readonly sourceFingerprint: string;
	/** Model-produced public summary; observers decide their own retention and redaction policy. */
	readonly summary?: string;
	readonly failure?: RuntimeObservationFailure;
}

export interface TeamWorkItemObservation extends TeamObservationCorrelation {
	readonly phase:
		| "created"
		| "queued"
		| "running"
		| "waiting"
		| "attention-required"
		| "completed"
		| "failed"
		| "cancelled"
		| "recovered";
	readonly issueCategory?: string;
	readonly recoveryTrigger?: "manual" | "automatic" | "external-change" | "startup";
	readonly failure?: RuntimeObservationFailure;
}

export interface TeamMemberRuntimeObservation extends TeamObservationCorrelation {
	readonly phase:
		| "create"
		| "start"
		| "progress"
		| "end"
		| "interrupted"
		| "wait"
		| "retry"
		| "continue"
		| "recover"
		| "abort";
	readonly attempt: number;
	readonly issueCategory?: string;
	readonly failure?: RuntimeObservationFailure;
}

/**
 * Safe correlation projection for the Runtime execution stream.
 *
 * Tool arguments/results stay in RuntimeSessionExecutionObservation, whose existing
 * execution-observer boundary can expose them to an explicitly authorized observer.
 * This record only provides the stable Team join keys and bounded structural facts;
 * it is safe for the ordinary Runtime Observation Hub.
 */
export interface TeamMemberToolExecutionObservation extends TeamObservationCorrelation {
	readonly runtimeSessionId: string;
	readonly runtimeTurnId: string;
	readonly phase: "started" | "updated" | "progress" | "completed" | "failed";
	readonly toolName: string;
	readonly inputFieldCount?: number;
	readonly contentItemCount?: number;
	readonly hasDetails?: boolean;
	readonly durationMs?: number;
	readonly isError?: boolean;
}

export type TeamMemberToolExecutionCorrelation = TeamObservationCorrelation & {
	readonly runtimeSessionId: string;
};

export interface TeamDeliveryObservation extends TeamObservationCorrelation {
	readonly phase: TeamMessageDeliveryPhase;
	readonly intent: "inform" | "question";
	readonly fromParticipantId: string;
	readonly toParticipantId: string;
}
export type TeamMessageDeliveryPhase = "pending" | "delivered" | "waiting" | "responded" | "failed" | "cancelled";

export interface TeamPublicationObservation extends TeamObservationCorrelation {
	readonly operationId: string;
	readonly phase: "prepared" | "message-published" | "completed" | "needs-recovery";
	readonly sourceParticipantConversationId: string;
	readonly sourceMessageEntryId: string;
	readonly generation: number;
	readonly recovered: boolean;
}

export const AGENT_TEAM_SESSION_LIFECYCLE = defineRuntimeObservation<TeamLifecycleObservation>(
	"agent-team.session",
	"lifecycle",
);
export const AGENT_TEAM_TURN_ROUTING = defineRuntimeObservation<TeamRoutingObservation>("agent-team.turn", "routing");
export const AGENT_TEAM_CONTEXT_PROJECTION = defineRuntimeObservation<TeamContextObservation>(
	"agent-team.context",
	"projection",
);
export const AGENT_TEAM_SHARED_CONTEXT_SUMMARY = defineRuntimeObservation<TeamSharedContextSummaryObservation>(
	"agent-team.context",
	"summary",
);
export const AGENT_TEAM_WORK_ITEM_LIFECYCLE = defineRuntimeObservation<TeamWorkItemObservation>(
	"agent-team.work-item",
	"lifecycle",
);
export const AGENT_TEAM_MEMBER_RUNTIME_LIFECYCLE = defineRuntimeObservation<TeamMemberRuntimeObservation>(
	"agent-team.member-runtime",
	"lifecycle",
);
export const AGENT_TEAM_MEMBER_TOOL_EXECUTION = defineRuntimeObservation<TeamMemberToolExecutionObservation>(
	"agent-team.member-runtime",
	"tool-execution",
);
export const AGENT_TEAM_MESSAGE_DELIVERY = defineRuntimeObservation<TeamDeliveryObservation>(
	"agent-team.message",
	"delivery",
);
export const AGENT_TEAM_PUBLICATION_LIFECYCLE = defineRuntimeObservation<TeamPublicationObservation>(
	"agent-team.publication",
	"lifecycle",
);

export interface TeamObservationPublisher {
	readonly session: RuntimeObservationPublisher;
	publishLifecycle(payload: TeamLifecycleObservation): void;
	publishRouting(payload: TeamRoutingObservation): void;
	publishContext(payload: TeamContextObservation): void;
	publishSharedContextSummary(payload: TeamSharedContextSummaryObservation): void;
	publishWorkItem(payload: TeamWorkItemObservation): void;
	publishMemberRuntime(payload: TeamMemberRuntimeObservation): void;
	publishMemberToolExecution(payload: TeamMemberToolExecutionObservation): void;
	publishDelivery(payload: TeamDeliveryObservation): void;
	publishPublication(payload: TeamPublicationObservation): void;
}

export function createTeamObservationPublisher(
	publisher: RuntimeObservationPublisher,
	coordinationConversationId: string,
): TeamObservationPublisher {
	const session = publisher.scope({ sessionId: coordinationConversationId });
	return {
		session,
		publishLifecycle: (payload) => session.record(AGENT_TEAM_SESSION_LIFECYCLE, payload),
		publishRouting: (payload) => session.record(AGENT_TEAM_TURN_ROUTING, payload),
		publishContext: (payload) => session.record(AGENT_TEAM_CONTEXT_PROJECTION, payload),
		publishSharedContextSummary: (payload) => session.record(AGENT_TEAM_SHARED_CONTEXT_SUMMARY, payload),
		publishWorkItem: (payload) => session.record(AGENT_TEAM_WORK_ITEM_LIFECYCLE, payload),
		publishMemberRuntime: (payload) =>
			session.record(AGENT_TEAM_MEMBER_RUNTIME_LIFECYCLE, payload, {
				...(payload.sourceTurnId ? { turnId: payload.sourceTurnId } : {}),
			}),
		publishMemberToolExecution: (payload) =>
			session.record(AGENT_TEAM_MEMBER_TOOL_EXECUTION, payload, {
				turnId: payload.runtimeTurnId,
				...(payload.toolCallId ? { toolCallId: payload.toolCallId } : {}),
			}),
		publishDelivery: (payload) =>
			session.record(AGENT_TEAM_MESSAGE_DELIVERY, payload, {
				...(payload.sourceTurnId ? { turnId: payload.sourceTurnId } : {}),
				...(payload.toolCallId ? { toolCallId: payload.toolCallId } : {}),
			}),
		publishPublication: (payload) =>
			session.record(AGENT_TEAM_PUBLICATION_LIFECYCLE, payload, {
				...(payload.sourceTurnId ? { turnId: payload.sourceTurnId } : {}),
				...(payload.toolCallId ? { toolCallId: payload.toolCallId } : {}),
			}),
	};
}

export function correlateTeamMemberToolExecution(
	correlation: TeamMemberToolExecutionCorrelation,
	observation: RuntimeSessionExecutionObservation,
): TeamMemberToolExecutionObservation | undefined {
	const event = observation.event;
	switch (event.type) {
		case "tool.execution.start":
			return {
				...correlation,
				runtimeTurnId: observation.turnId,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				phase: "started",
				inputFieldCount: isRecord(event.args) ? Object.keys(event.args).length : 0,
			};
		case "tool.execution.update":
			return {
				...correlation,
				runtimeTurnId: observation.turnId,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				phase: "updated",
				contentItemCount: event.partialResult.content.length,
				hasDetails: event.partialResult.details !== undefined,
				isError: event.partialResult.isError === true,
			};
		case "tool.execution.phase":
			return {
				...correlation,
				runtimeTurnId: observation.turnId,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				phase: "progress",
				durationMs: event.atMs,
			};
		case "tool.execution.end":
			return {
				...correlation,
				runtimeTurnId: observation.turnId,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				phase: event.isError ? "failed" : "completed",
				contentItemCount: event.result.content.length,
				hasDetails: event.result.details !== undefined,
				durationMs: event.durationMs,
				isError: event.isError,
			};
		default:
			return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
