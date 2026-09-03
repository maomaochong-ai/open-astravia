import type { TeamSessionDocument } from "./contracts.js";

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
export function teamUserMessageId(teamSessionId: string, requestId: string): string {
	return stableTeamEventId(["user-message", teamSessionId, requestId]);
}

export function teamMemberResultMessageId(
	teamSessionId: string,
	requestId: string,
	memberId: string,
	sourceTurnId: string,
): string {
	return stableTeamEventId(["member-result", teamSessionId, requestId, memberId, sourceTurnId]);
}

export function teamDelegationActivityId(
	teamSessionId: string,
	requestId: string,
	sourceMemberId: string,
	targetMemberId: string,
): string {
	return stableTeamEventId(["member-delegation", teamSessionId, requestId, sourceMemberId, targetMemberId]);
}
/** Updates the member's private shared-context cursor without duplicating a public message in TeamSessionDocument. */
export function markTeamMemberContextDelivered(input: {
	readonly session: TeamSessionDocument;
	readonly memberId: string;
	readonly deliveredEventIds: readonly string[];
	readonly timestamp: number;
}): TeamSessionDocument {
	const runtimeState = input.session.memberRuntime[input.memberId];
	if (!runtimeState) throw new Error(`Team member runtime not found: ${input.memberId}`);
	return {
		...input.session,
		revision: input.session.revision + 1,
		updatedAt: input.timestamp,
		memberRuntime: {
			...input.session.memberRuntime,
			[input.memberId]: {
				...runtimeState,
				deliveredEventIds: [...new Set([...runtimeState.deliveredEventIds, ...input.deliveredEventIds])],
			},
		},
	};
}
