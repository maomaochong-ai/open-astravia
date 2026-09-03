import { resolve } from "node:path";
import { ensureLegacyAgentTeamOwnershipCatalog } from "../agent-teams/team-ownership-backfill.js";
import { type ConversationOwner, conversationOwnershipCatalog } from "./conversation-ownership-catalog.js";

export interface ConversationOwnershipGuardDependencies {
	ensureReady(): Promise<void>;
	getOwner(sessionPath: string): Promise<ConversationOwner | undefined>;
}

const defaultDependencies: ConversationOwnershipGuardDependencies = {
	ensureReady: () => ensureLegacyAgentTeamOwnershipCatalog(),
	getOwner: (sessionPath) => conversationOwnershipCatalog.getOwner(sessionPath),
};

/** Protects ordinary-product commands from targeting a Conversation owned by another product. */
export async function assertOrdinaryConversationPath(
	sessionPath: string,
	dependencies: ConversationOwnershipGuardDependencies = defaultDependencies,
): Promise<string> {
	const absolutePath = resolve(sessionPath);
	await dependencies.ensureReady();
	const owner = await dependencies.getOwner(absolutePath);
	if (owner) {
		throw new Error(`Conversation is managed by Agent Team: ${owner.teamId}/${owner.teamSessionId}`);
	}
	return absolutePath;
}
