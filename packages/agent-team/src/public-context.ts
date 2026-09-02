import type { ConversationAuthorReference } from "@vetta/runtime-core/conversation";
import type { TeamSharedContextRecord } from "./contracts.js";
import type { TeamContextProjectionPolicy } from "./extensions.js";

/** The policy owns selection from both sources; callers must not append bypass records. */
export function projectPublicTeamContext(
	input: Parameters<TeamContextProjectionPolicy["project"]>[0],
): readonly TeamSharedContextRecord[] {
	const { session, messages = [], targetMemberId, deliveredEventIds, currentRequestId } = input;
	const records: TeamSharedContextRecord[] = [];
	const ordinaryIds = new Set(messages.map((message) => message.id));
	for (const record of messages) {
		if (deliveredEventIds.has(record.id)) continue;
		if (record.kind === "user" && record.turnId === currentRequestId) continue;
		if (record.kind === "agent" && record.author.id === targetMemberId) continue;
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
	for (const event of session.events) {
		// Ordinary messages are authoritative, including when excluded above.
		if (ordinaryIds.has(event.id) || deliveredEventIds.has(event.id)) continue;
		if (event.type === "user-message" && event.requestId === currentRequestId) continue;
		if (event.type === "member-result" && event.memberId === targetMemberId) continue;
		if (event.type === "member-delegation" && event.targetMemberId !== targetMemberId) continue;
		const author: ConversationAuthorReference =
			event.type === "user-message"
				? { kind: "user", id: "local-user" }
				: { kind: "agent", id: event.type === "member-result" ? event.memberId : event.sourceMemberId };
		records.push({
			eventId: event.id,
			type:
				event.type === "user-message"
					? "agent-team.user-message.v1"
					: event.type === "member-result"
						? "agent-team.member-result.v1"
						: "agent-team.member-delegation.v1",
			text: event.type === "member-delegation" ? event.objective : event.text,
			timestamp: event.timestamp,
			...(event.type === "user-message" && event.attachments?.length ? { artifactRefs: event.attachments } : {}),
			metadata: {
				teamSessionId: session.id,
				requestId: event.requestId,
				author,
				...(author.kind === "agent" ? { sourceMemberId: author.id } : {}),
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
