import type { ConversationAuthorReference } from "@vetta/runtime-core/conversation";
import type { TeamSharedContextRecord } from "./contracts.js";
import type { TeamContextProjectionPolicy } from "./extensions.js";

/** The policy owns selection from both sources; callers must not append bypass records. */
export function projectPublicTeamContext(
	input: Parameters<TeamContextProjectionPolicy["project"]>[0],
): readonly TeamSharedContextRecord[] {
	return projectPublicContext(input, input.targetMemberId);
}

export function projectPublicTeamCheckpointContext(
	input: Parameters<NonNullable<TeamContextProjectionPolicy["projectSharedCheckpoint"]>>[0],
): readonly TeamSharedContextRecord[] {
	return projectPublicContext({ ...input, deliveredEventIds: new Set() });
}

function projectPublicContext(
	input: {
		readonly session: Parameters<TeamContextProjectionPolicy["project"]>[0]["session"];
		readonly messages: Parameters<TeamContextProjectionPolicy["project"]>[0]["messages"];
		readonly deliveredEventIds: ReadonlySet<string>;
		readonly currentRequestId?: string;
	},
	targetMemberId?: string,
): readonly TeamSharedContextRecord[] {
	const { session, messages, deliveredEventIds, currentRequestId } = input;
	const records: TeamSharedContextRecord[] = [];
	for (const record of messages) {
		if (deliveredEventIds.has(record.id)) continue;
		if (record.kind === "user" && record.turnId === currentRequestId) continue;
		if (targetMemberId && record.kind === "agent" && record.author.id === targetMemberId) continue;
		const content = record.message.content;
		records.push({
			eventId: record.id,
			type: record.kind === "user" ? "agent-team.user-message.v1" : "agent-team.member-result.v1",
			text:
				typeof content === "string"
					? content
					: content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("\n"),
			timestamp: record.timestamp,
			...(record.kind === "user" && record.attachments?.length ? { artifactRefs: record.attachments } : {}),
			metadata: {
				teamSessionId: session.id,
				requestId: record.turnId,
				author: record.author,
				...(record.kind === "agent" ? { sourceMemberId: record.author.id } : {}),
			},
		});
	}
	return records.sort((left, right) => left.timestamp - right.timestamp);
}

/** JSON keeps author identity and message text separate, including embedded markup. */
export function formatTeamSharedContext(
	record: TeamSharedContextRecord,
	memberHandles: Readonly<Record<string, string>>,
): string {
	const author: ConversationAuthorReference | undefined =
		record.metadata.author ??
		(record.metadata.sourceMemberId
			? { kind: "agent", id: record.metadata.sourceMemberId }
			: record.type === "agent-team.user-message.v1"
				? { kind: "user", id: "local-user" }
				: undefined);
	return JSON.stringify({
		type: record.type,
		sourceEntryId: record.eventId,
		requestId: record.metadata.requestId,
		author,
		...(author?.kind === "agent" && memberHandles[author.id] ? { handle: memberHandles[author.id] } : {}),
		text: record.text,
		...(record.artifactRefs?.length ? { artifactRefs: record.artifactRefs } : {}),
	});
}
