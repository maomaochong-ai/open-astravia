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

export const AGENT_TEAM_SESSION_LIFECYCLE = defineRuntimeObservation<TeamLifecycleObservation>(
	"agent-team.session",
	"lifecycle",
);
export const AGENT_TEAM_TURN_ROUTING = defineRuntimeObservation<TeamRoutingObservation>("agent-team.turn", "routing");
export const AGENT_TEAM_CONTEXT_PROJECTION = defineRuntimeObservation<TeamContextObservation>(
	"agent-team.context",
	"projection",
);
export const AGENT_TEAM_WORK_ITEM_LIFECYCLE = defineRuntimeObservation<TeamWorkItemObservation>(
	"agent-team.work-item",
	"lifecycle",
);
export const AGENT_TEAM_MEMBER_RUNTIME_LIFECYCLE = defineRuntimeObservation<TeamMemberRuntimeObservation>(
	"agent-team.member-runtime",
	"lifecycle",
);

export interface TeamObservationPublisher {
	readonly session: RuntimeObservationPublisher;
	publishLifecycle(payload: TeamLifecycleObservation): void;
	publishRouting(payload: TeamRoutingObservation): void;
	publishContext(payload: TeamContextObservation): void;
	publishWorkItem(payload: TeamWorkItemObservation): void;
	publishMemberRuntime(payload: TeamMemberRuntimeObservation): void;
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
		publishWorkItem: (payload) => session.record(AGENT_TEAM_WORK_ITEM_LIFECYCLE, payload),
		publishMemberRuntime: (payload) =>
			session.record(AGENT_TEAM_MEMBER_RUNTIME_LIFECYCLE, payload, {
				...(payload.sourceTurnId ? { turnId: payload.sourceTurnId } : {}),
			}),
	};
}
