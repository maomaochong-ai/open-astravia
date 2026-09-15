import type { TeamSessionDocument, TeamWorkItem } from "@vetta/agent-team";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import type { TeamCollaborationState } from "./team-collaboration-store.js";
import type { TeamMemberTurnRequest } from "./team-member-turn-request.js";

const CONTINUATION_SUFFIX = /:continuation:\d+$/u;
const CONTINUATION_OBJECTIVE = "Integrate completed Agent Team task results";

export interface TeamInitiatorContinuationPlan {
	readonly workItemId: string;
	readonly request: TeamMemberTurnRequest;
}

/**
 * Decides which Team attempt carries an initiator's wake-up after its delegated
 * task completed. A Runtime continuation outside an attempt has neither a live
 * Team stream nor a publication, so its answer would never reach the timeline.
 *
 * - The initiator's latest work item is still open (typically `waiting` after a
 *   provider failure): continue that item, so the answer joins the same turn.
 * - It already reached a terminal state: open a follow-up item for the same request.
 * - The initiator has no work item, or it is unexpectedly still running: no plan;
 *   the caller falls back to a plain Runtime continuation.
 */
export function planTeamInitiatorContinuation(input: {
	readonly session: TeamSessionDocument;
	readonly state: TeamCollaborationState;
	readonly memberId: string;
	readonly records: readonly SessionContextRecord[];
}): TeamInitiatorContinuationPlan | undefined {
	const { session, state, memberId, records } = input;
	const owner = latestWorkItemAssignedTo(state.workItems, memberId);
	if (!owner || owner.state === "running") return undefined;
	const modelSettings = {
		...(session.modelSettings?.modelKey ? { modelKey: session.modelSettings.modelKey } : {}),
		...(session.modelSettings?.reasoning ? { reasoning: session.modelSettings.reasoning } : {}),
	};
	if (owner.state === "waiting" || owner.state === "attention-required") {
		const attemptNumber = state.attempts.filter((attempt) => attempt.workItemId === owner.id).length + 1;
		return {
			workItemId: owner.id,
			request: {
				teamSessionId: session.id,
				memberId,
				promptText: owner.objective,
				requestId: owner.requestTurnId,
				sourceTurnId: `${owner.requestTurnId}:${memberId}:continuation:${attemptNumber}`,
				createdByParticipantId: owner.createdByParticipantId,
				...(owner.artifactRefs?.length ? { attachments: owner.artifactRefs } : {}),
				...(owner.kind ? { workItemKind: owner.kind } : {}),
				...modelSettings,
				mode: "continue",
				continuationContext: records,
			},
		};
	}
	const rootRequestId = owner.requestTurnId.replace(CONTINUATION_SUFFIX, "");
	const followUpPrefix = `${rootRequestId}:continuation:`;
	const followUpCount = state.workItems.filter(
		(item) => item.assignedToParticipantId === memberId && item.requestTurnId.startsWith(followUpPrefix),
	).length;
	const requestId = `${followUpPrefix}${followUpCount + 1}`;
	return {
		workItemId: `work:${requestId}:${memberId}`,
		request: {
			teamSessionId: session.id,
			memberId,
			promptText: CONTINUATION_OBJECTIVE,
			requestId,
			sourceTurnId: `${requestId}:${memberId}`,
			createdByParticipantId: owner.createdByParticipantId,
			...(owner.kind ? { workItemKind: owner.kind } : {}),
			...modelSettings,
			mode: "continue",
			continuationContext: records,
		},
	};
}

function latestWorkItemAssignedTo(items: readonly TeamWorkItem[], memberId: string): TeamWorkItem | undefined {
	let latest: TeamWorkItem | undefined;
	for (const item of items) {
		if (item.assignedToParticipantId !== memberId) continue;
		if (!latest || item.createdAt >= latest.createdAt) latest = item;
	}
	return latest;
}
