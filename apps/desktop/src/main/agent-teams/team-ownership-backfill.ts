import type { TeamSessionDocument } from "@vetta/agent-team";
import type {
	ConversationOwnershipCatalogPort,
	ConversationOwnershipRecord,
} from "../conversations/conversation-ownership-catalog.js";
import { conversationOwnershipCatalog } from "../conversations/conversation-ownership-catalog.js";
import { type LegacyTeamSessionSource, listLegacyTeamSessionDocuments } from "./team-session-legacy-source.js";

const backfills = new WeakMap<ConversationOwnershipCatalogPort, Promise<void>>();

export function agentTeamConversationOwnershipRecords(
	session: TeamSessionDocument,
): readonly ConversationOwnershipRecord[] {
	const common = {
		title: session.name,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
	};
	return [
		...(session.coordinationRuntime
			? [
					{
						...common,
						sessionPath: session.coordinationRuntime.sessionPath,
						owner: {
							kind: "agent-team" as const,
							teamId: session.teamId,
							teamSessionId: session.id,
							role: "coordination" as const,
						},
					},
				]
			: []),
		...Object.values(session.memberRuntime).map((runtime) => ({
			...common,
			sessionPath: runtime.sessionPath,
			owner: {
				kind: "agent-team" as const,
				teamId: session.teamId,
				teamSessionId: session.id,
				role: "member" as const,
			},
		})),
	];
}

export function registerAgentTeamSessionOwnership(
	session: TeamSessionDocument,
	catalog: ConversationOwnershipCatalogPort,
): Promise<void> {
	return catalog.register(agentTeamConversationOwnershipRecords(session));
}

/** Completes legacy ownership discovery before any product publishes an ordinary Conversation list. */
export function ensureLegacyAgentTeamOwnershipCatalog(
	source: LegacyTeamSessionSource = { list: () => listLegacyTeamSessionDocuments() },
	catalog: ConversationOwnershipCatalogPort = conversationOwnershipCatalog,
): Promise<void> {
	if (!source.list) return Promise.resolve();
	const current = backfills.get(catalog);
	if (current) return current;
	const operation = source
		.list()
		.then((sessions) => catalog.register(sessions.flatMap(agentTeamConversationOwnershipRecords)));
	backfills.set(catalog, operation);
	void operation.catch(() => {
		if (backfills.get(catalog) === operation) backfills.delete(catalog);
	});
	return operation;
}
