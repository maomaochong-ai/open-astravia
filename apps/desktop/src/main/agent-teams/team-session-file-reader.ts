import { dirname } from "node:path";
import type { HistoryEntry } from "@vetta/runtime-core";
import { type ConversationDocument, projectConversationDocumentHistory } from "@vetta/runtime-core/conversation";
import { FileConversationRepository, resolveSessionIdFromPath } from "@vetta/runtime-node/conversation";

/**
 * Reads a native Conversation directly from its JSONL file. This is deliberately
 * a read-only bootstrap adapter: it does not construct a Runtime or register an
 * active session. Runtime restoration remains the responsibility of the service.
 */
export async function readTeamConversationDocument(
	conversationSessionId: string,
	sessionPath: string,
): Promise<ConversationDocument> {
	if (resolveTeamConversationSessionId(sessionPath) !== conversationSessionId) {
		throw new Error("Team Conversation path does not match its session id");
	}
	const directory = dirname(sessionPath);
	const repository = new FileConversationRepository({ rootDir: directory });
	try {
		return await repository.readDocument(conversationSessionId);
	} finally {
		await repository.close();
	}
}

/** Returns the native Conversation id encoded by a Team Conversation path. */
export function resolveTeamConversationSessionId(sessionPath: string): string {
	const conversationSessionId = resolveSessionIdFromPath(dirname(sessionPath), sessionPath);
	if (!conversationSessionId) {
		throw new Error(`Team Conversation path does not match its session id: ${sessionPath}`);
	}
	return conversationSessionId;
}

/** Reads the same persisted history contract consumed by the ordinary Chat UI. */
export async function readTeamConversationHistory(
	conversationSessionId: string,
	sessionPath: string,
): Promise<HistoryEntry[]> {
	return projectConversationDocumentHistory(await readTeamConversationDocument(conversationSessionId, sessionPath));
}
