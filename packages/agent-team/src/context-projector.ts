import type { PromptAttachmentRef } from "@vetta/runtime-core";
import type { TeamFeedEvent, TeamSessionDocument, TeamSharedContextRecord } from "./contracts.js";
import { DEFAULT_AGENT_TEAM_EXTENSIONS } from "./extensions.js";

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;
function fnv64(value: string, seed: bigint): string {
	let hash = seed;
	for (const byte of new TextEncoder().encode(value)) {
		hash ^= BigInt(byte);
		hash = (hash * FNV_PRIME) & MASK_64;
	}
	return hash.toString(16).padStart(16, "0");
}
export function stableTeamEventId(parts: readonly string[]): string {
	const canonical = parts.map((part) => `${part.length}:${part}`).join("|");
	return `team-v1-${fnv64(canonical, FNV_OFFSET)}${fnv64(canonical, FNV_OFFSET ^ MASK_64)}`;
}
export function createUserMessageEvent(input: {
	readonly teamSessionId: string;
	readonly requestId: string;
	readonly text: string;
	readonly targetMemberIds: readonly string[];
	readonly attachments?: readonly PromptAttachmentRef[];
	readonly timestamp: number;
}): Extract<TeamFeedEvent, { type: "user-message" }> {
	return {
		type: "user-message",
		id: stableTeamEventId(["user-message", input.teamSessionId, input.requestId]),
		requestId: input.requestId,
		text: input.text,
		targetMemberIds: [...input.targetMemberIds],
		...(input.attachments?.length ? { attachments: [...input.attachments] } : {}),
		timestamp: input.timestamp,
	};
}
export function createMemberResultEvent(input: {
	readonly teamSessionId: string;
	readonly requestId: string;
	readonly memberId: string;
	readonly sourceTurnId: string;
	readonly text: string;
	readonly timestamp: number;
}): Extract<TeamFeedEvent, { type: "member-result" }> {
	return {
		type: "member-result",
		id: stableTeamEventId([
			"member-result",
			input.teamSessionId,
			input.requestId,
			input.memberId,
			input.sourceTurnId,
		]),
		requestId: input.requestId,
		memberId: input.memberId,
		sourceTurnId: input.sourceTurnId,
		text: input.text,
		timestamp: input.timestamp,
	};
}

export function createMemberDelegationEvent(input: {
	readonly teamSessionId: string;
	readonly requestId: string;
	readonly sourceMemberId: string;
	readonly targetMemberId: string;
	readonly objective: string;
	readonly timestamp: number;
}): Extract<TeamFeedEvent, { type: "member-delegation" }> {
	return {
		type: "member-delegation",
		id: stableTeamEventId([
			"member-delegation",
			input.teamSessionId,
			input.requestId,
			input.sourceMemberId,
			input.targetMemberId,
		]),
		requestId: input.requestId,
		sourceMemberId: input.sourceMemberId,
		targetMemberId: input.targetMemberId,
		objective: input.objective,
		timestamp: input.timestamp,
	};
}

export function finalizeTeamMemberTurn(input: {
	readonly session: TeamSessionDocument;
	readonly memberId: string;
	readonly result: Extract<TeamFeedEvent, { type: "member-result" }>;
	readonly deliveredEventIds: readonly string[];
	readonly timestamp: number;
}): TeamSessionDocument {
	const runtimeState = input.session.memberRuntime[input.memberId];
	if (!runtimeState) throw new Error(`Team member runtime not found: ${input.memberId}`);
	return {
		...input.session,
		revision: input.session.revision + 1,
		updatedAt: input.timestamp,
		events: [...input.session.events.filter((event) => event.id !== input.result.id), input.result],
		memberRuntime: {
			...input.session.memberRuntime,
			[input.memberId]: {
				...runtimeState,
				deliveredEventIds: [...new Set([...runtimeState.deliveredEventIds, ...input.deliveredEventIds])],
			},
		},
	};
}
export function projectUndeliveredTeamContext(
	session: Pick<TeamSessionDocument, "id" | "events">,
	targetMemberId: string,
	deliveredEventIds: ReadonlySet<string>,
	currentRequestId?: string,
): readonly TeamSharedContextRecord[] {
	const policy = DEFAULT_AGENT_TEAM_EXTENSIONS.contextPolicies.get("public-results-v1");
	if (!policy) throw new Error("Default team context policy is not registered");
	return policy.project({ session, targetMemberId, deliveredEventIds, currentRequestId });
}
