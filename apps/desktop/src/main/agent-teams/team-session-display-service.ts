import type {
	TeamMemberTurnAttempt,
	TeamMessageRoutingRecord,
	TeamSessionDocument,
	TeamSessionSnapshot,
	TeamWorkItem,
} from "@vetta/agent-team";
import type { ConversationDocument, RuntimeHost } from "@vetta/runtime-core";
import type { DesktopTeamConversationDisplay } from "../../preload/api-types/team-conversation-display.js";
import type { TeamCollaborationStore } from "./team-collaboration-store.js";
import { projectTeamConversationDisplay } from "./team-conversation-display.js";
import { publicAssistantMessage } from "./team-public-message.js";
import { readTeamConversationHistory } from "./team-session-file-reader.js";

/**
 * Owns the read side of a Team session.
 *
 * Coordination history is the public Team timeline. Member histories are
 * exposed only through the explicit desktop display projection, so callers do
 * not have to merge two different visibility domains themselves.
 */
export class TeamSessionDisplayService {
	constructor(
		private readonly runtime: () => RuntimeHost,
		private readonly collaborationStore: TeamCollaborationStore,
	) {}

	snapshot(session: TeamSessionDocument, coordinationDocument?: ConversationDocument): TeamSessionSnapshot {
		const coordination = session.coordinationRuntime;
		if (!coordination) {
			return {
				session,
				conversationRevision: 0,
				messages: [],
				activities: legacyActivities(session),
				userMessageAnnotations: [],
			};
		}
		const document = coordinationDocument ?? this.runtime().readSessionDocument(coordination.sessionId);
		const collaboration = coordinationDocument
			? this.collaborationStore.readFromDocument(coordinationDocument)
			: this.collaborationStore.read(session);
		const messages = projectTeamPublicMessages(document);
		return {
			session,
			conversationRevision: document.revision,
			messages,
			activities: teamActivities(session, collaboration.workItems, collaboration.attempts, messages),
			userMessageAnnotations: projectTeamUserMessageAnnotations(document),
		};
	}

	/** Desktop-only display projection; never persisted or passed to member context. */
	async displayProjection(session: TeamSessionDocument): Promise<DesktopTeamConversationDisplay> {
		const runtime = this.runtime();
		const memberStates =
			typeof runtime.getState === "function"
				? Object.entries(session.memberRuntime)
						.filter(([, member]) => runtime.getSessionPath(member.sessionId) === member.sessionPath)
						.map(([memberId, member]) => ({
							memberId,
							runtimeSessionId: member.sessionId,
							state: runtime.getState(member.sessionId),
						}))
				: [];
		const contextState = memberStates.reduce<(typeof memberStates)[number] | undefined>((largest, candidate) => {
			if (!largest) return candidate;
			const usage = (item: (typeof memberStates)[number]) =>
				item.state.contextTokens != null && item.state.contextWindow > 0
					? item.state.contextTokens / item.state.contextWindow
					: (item.state.contextPercent ?? 0) / 100;
			return usage(candidate) > usage(largest) ? candidate : largest;
		}, undefined);
		const orderedMemberStates = contextState
			? [contextState, ...memberStates.filter((candidate) => candidate !== contextState)]
			: memberStates;
		return projectTeamConversationDisplay({
			session,
			readHistory: async (runtimeSessionId, sessionPath) =>
				runtime.getSessionPath(runtimeSessionId) === sessionPath
					? runtime.getFullHistory(runtimeSessionId)
					: readTeamConversationHistory(runtimeSessionId, sessionPath),
			...(orderedMemberStates.length > 0
				? {
						runtimeStates: orderedMemberStates.map(({ memberId, runtimeSessionId, state }) => ({
							executionMode: session.executionMode ?? state.executionMode,
							contextPercent: state.contextPercent,
							memberId,
							runtimeSessionId,
							...(state.contextTokens === undefined ? {} : { contextTokens: state.contextTokens }),
							contextWindow: state.contextWindow,
							...(state.contextComposition ? { composition: state.contextComposition } : {}),
						})),
					}
				: {}),
		});
	}
}

/**
 * The coordination Conversation is also the durable delivery ledger. Agent
 * messages routed only to other Team members belong to that ledger, but the
 * aggregate UI already represents them as delegation activities. Exposing
 * both produced a second leader bubble before the actual public answer.
 */
export function projectTeamPublicMessages(document: ConversationDocument): TeamSessionSnapshot["messages"] {
	const internalAgentMessageIds = new Set(
		document.entries.flatMap((entry) => {
			if (entry.type !== "custom" || entry.customType !== "agent-team.message-routing.v1") return [];
			const routing = readTeamMessageRouting(entry.data);
			if (!routing?.addressedParticipantIds?.length) return [];
			return routing.addressedParticipantIds.every((participantId) => participantId !== "local-user")
				? [routing.messageEntryId]
				: [];
		}),
	);
	return document.entries.flatMap((entry) => {
		if (entry.type !== "message" || (entry.kind !== "user" && entry.kind !== "agent")) return [];
		if (entry.kind === "agent" && internalAgentMessageIds.has(entry.id)) return [];
		const record =
			entry.kind === "user"
				? {
						kind: entry.kind,
						id: entry.id,
						turnId: entry.turnId,
						timestamp: entry.message.timestamp,
						author: entry.author,
						message: entry.message,
						...(entry.attachments?.length ? { attachments: entry.attachments } : {}),
					}
				: {
						kind: entry.kind,
						id: entry.id,
						turnId: entry.turnId,
						timestamp: entry.message.timestamp,
						author: entry.author,
						message: publicAssistantMessage(entry.message),
					};
		return [record];
	});
}

export function projectTeamUserMessageAnnotations(
	document: ConversationDocument,
): NonNullable<TeamSessionSnapshot["userMessageAnnotations"]> {
	return document.entries.flatMap((entry) => {
		if (entry.type !== "custom" || entry.customType !== "agent-team.message-routing.v1") return [];
		const routing = readTeamMessageRouting(entry.data);
		if (!routing || !Array.isArray(routing.memberMentions) || !routing.memberMentions.every(isTeamUserMessageMention))
			return [];
		return [
			{
				messageEntryId: routing.messageEntryId,
				participantIds: [...new Set(routing.memberMentions.map((mention) => mention.participantId))],
				mentions: routing.memberMentions.map((mention) => ({ ...mention })),
			},
		];
	});
}

function isTeamUserMessageMention(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const mention = value as Record<string, unknown>;
	return (
		typeof mention.participantId === "string" &&
		typeof mention.handle === "string" &&
		Number.isInteger(mention.start) &&
		Number.isInteger(mention.end)
	);
}

function readTeamMessageRouting(value: unknown): TeamMessageRoutingRecord | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const candidate = value as Partial<TeamMessageRoutingRecord>;
	if (candidate.customType !== "agent-team.message-routing.v1" || typeof candidate.messageEntryId !== "string")
		return undefined;
	if (
		candidate.addressedParticipantIds !== undefined &&
		(!Array.isArray(candidate.addressedParticipantIds) ||
			!candidate.addressedParticipantIds.every((participantId) => typeof participantId === "string"))
	)
		return undefined;
	return candidate as TeamMessageRoutingRecord;
}

function teamActivities(
	session: TeamSessionDocument,
	workItems: readonly TeamWorkItem[],
	attempts: readonly TeamMemberTurnAttempt[],
	messages: readonly TeamSessionSnapshot["messages"][number][],
): TeamSessionSnapshot["activities"] {
	const activities = new Map<string, TeamSessionSnapshot["activities"][number]>();
	for (const activity of legacyActivities(session)) activities.set(delegationIdentity(activity), activity);
	const attemptsById = new Map(attempts.map((attempt) => [attempt.id, attempt]));
	for (const item of workItems) {
		if (item.createdByParticipantId === "local-user") continue;
		const previous = activities.get(
			`${item.requestTurnId}\u0000${item.createdByParticipantId}\u0000${item.assignedToParticipantId}`,
		);
		const resultMessageTurnId = item.resultMessageId
			? messages.find((message) => message.id === item.resultMessageId)?.turnId
			: undefined;
		const sourceTurnId =
			(item.currentAttemptId ? attemptsById.get(item.currentAttemptId)?.sourceTurnId : undefined) ??
			previous?.sourceTurnId ??
			(resultMessageTurnId && resultMessageTurnId !== item.requestTurnId ? resultMessageTurnId : undefined);
		const activity = {
			kind: "delegation" as const,
			id: item.id,
			requestId: item.requestTurnId,
			...(item.originToolCallId ? { originToolCallId: item.originToolCallId } : {}),
			...(sourceTurnId ? { sourceTurnId } : {}),
			sourceMemberId: item.createdByParticipantId,
			targetMemberId: item.assignedToParticipantId,
			objective: item.objective,
			state: item.state,
			timestamp: item.createdAt,
		};
		activities.set(delegationIdentity(activity), activity);
	}
	return [...activities.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function legacyActivities(session: TeamSessionDocument): TeamSessionSnapshot["activities"] {
	const results = new Map(
		session.events
			.filter((event): event is Extract<typeof event, { type: "member-result" }> => event.type === "member-result")
			.map((event) => [`${event.requestId}\u0000${event.memberId}`, event]),
	);
	return session.events.flatMap((event) => {
		if (event.type !== "member-delegation") return [];
		const result = results.get(`${event.requestId}\u0000${event.targetMemberId}`);
		return [
			{
				kind: "delegation" as const,
				id: event.id,
				requestId: event.requestId,
				...(result ? { sourceTurnId: result.sourceTurnId } : {}),
				sourceMemberId: event.sourceMemberId,
				targetMemberId: event.targetMemberId,
				objective: event.objective,
				state: result ? ("completed" as const) : ("waiting" as const),
				timestamp: event.timestamp,
			},
		];
	});
}

function delegationIdentity(activity: TeamSessionSnapshot["activities"][number]): string {
	return `${activity.requestId}\u0000${activity.sourceMemberId}\u0000${activity.targetMemberId}`;
}
