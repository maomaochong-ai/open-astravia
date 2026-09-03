import type { PromptAttachmentRef } from "@vetta/runtime-core";
import { teamDelegationActivityId, teamMemberResultMessageId, teamUserMessageId } from "./context-projector.js";
import type { LegacyTeamFeedEvent } from "./contracts.js";

/** Creates schema-v1 migration input. Never use this for a current Team message. */
export function createLegacyTeamUserMessageEvent(input: {
	readonly teamSessionId: string;
	readonly requestId: string;
	readonly text: string;
	readonly targetMemberIds: readonly string[];
	readonly attachments?: readonly PromptAttachmentRef[];
	readonly timestamp: number;
}): Extract<LegacyTeamFeedEvent, { type: "user-message" }> {
	return {
		type: "user-message",
		id: teamUserMessageId(input.teamSessionId, input.requestId),
		requestId: input.requestId,
		text: input.text,
		targetMemberIds: [...input.targetMemberIds],
		...(input.attachments?.length ? { attachments: [...input.attachments] } : {}),
		timestamp: input.timestamp,
	};
}

/** Creates schema-v1 migration input. Never use this for a current Team message. */
export function createLegacyTeamMemberResultEvent(input: {
	readonly teamSessionId: string;
	readonly requestId: string;
	readonly memberId: string;
	readonly sourceTurnId: string;
	readonly text: string;
	readonly timestamp: number;
}): Extract<LegacyTeamFeedEvent, { type: "member-result" }> {
	return {
		type: "member-result",
		id: teamMemberResultMessageId(input.teamSessionId, input.requestId, input.memberId, input.sourceTurnId),
		requestId: input.requestId,
		memberId: input.memberId,
		sourceTurnId: input.sourceTurnId,
		text: input.text,
		timestamp: input.timestamp,
	};
}

/** Creates schema-v1 migration input. Never use this for a current Team activity. */
export function createLegacyTeamMemberDelegationEvent(input: {
	readonly teamSessionId: string;
	readonly requestId: string;
	readonly sourceMemberId: string;
	readonly targetMemberId: string;
	readonly objective: string;
	readonly timestamp: number;
}): Extract<LegacyTeamFeedEvent, { type: "member-delegation" }> {
	return {
		type: "member-delegation",
		id: teamDelegationActivityId(input.teamSessionId, input.requestId, input.sourceMemberId, input.targetMemberId),
		requestId: input.requestId,
		sourceMemberId: input.sourceMemberId,
		targetMemberId: input.targetMemberId,
		objective: input.objective,
		timestamp: input.timestamp,
	};
}
