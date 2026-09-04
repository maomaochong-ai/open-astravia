import type { TeamSessionDocument, TeamSessionSnapshot, TeamWorkItem } from "@vetta/agent-team";
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
			};
		}
		const document = coordinationDocument ?? this.runtime().readSessionDocument(coordination.sessionId);
		const collaboration = coordinationDocument
			? this.collaborationStore.readFromDocument(coordinationDocument)
			: this.collaborationStore.read(session);
		const messages = document.entries.flatMap((entry) => {
			if (entry.type !== "message" || (entry.kind !== "user" && entry.kind !== "agent")) return [];
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
		return {
			session,
			conversationRevision: document.revision,
			messages,
			activities: teamActivities(session, collaboration.workItems),
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

function teamActivities(
	session: TeamSessionDocument,
	workItems: readonly TeamWorkItem[],
): TeamSessionSnapshot["activities"] {
	const activities = new Map<string, TeamSessionSnapshot["activities"][number]>();
	for (const activity of legacyActivities(session)) activities.set(delegationIdentity(activity), activity);
	for (const item of workItems) {
		if (item.createdByParticipantId === "local-user") continue;
		const activity = {
			kind: "delegation" as const,
			id: item.id,
			requestId: item.requestTurnId,
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
	const completed = new Set(
		session.events
			.filter((event) => event.type === "member-result")
			.map((event) => `${event.requestId}\u0000${event.memberId}`),
	);
	return session.events.flatMap((event) =>
		event.type === "member-delegation"
			? [
					{
						kind: "delegation" as const,
						id: event.id,
						requestId: event.requestId,
						sourceMemberId: event.sourceMemberId,
						targetMemberId: event.targetMemberId,
						objective: event.objective,
						state: completed.has(`${event.requestId}\u0000${event.targetMemberId}`)
							? ("completed" as const)
							: ("waiting" as const),
						timestamp: event.timestamp,
					},
				]
			: [],
	);
}

function delegationIdentity(activity: TeamSessionSnapshot["activities"][number]): string {
	return `${activity.requestId}\u0000${activity.sourceMemberId}\u0000${activity.targetMemberId}`;
}
