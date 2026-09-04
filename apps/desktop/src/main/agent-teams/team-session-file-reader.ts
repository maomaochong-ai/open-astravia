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
	sessionId: string,
	sessionPath: string,
): Promise<ConversationDocument> {
	const directory = dirname(sessionPath);
	if (resolveSessionIdFromPath(directory, sessionPath) !== sessionId) {
		throw new Error("Team Conversation path does not match its session id");
	}
	const repository = new FileConversationRepository({ rootDir: directory });
	try {
		return await repository.readDocument(sessionId);
	} finally {
		await repository.close();
	}
}

/** Reads the same persisted history contract consumed by the ordinary Chat UI. */
export async function readTeamConversationHistory(sessionId: string, sessionPath: string): Promise<HistoryEntry[]> {
	return projectConversationDocumentHistory(await readTeamConversationDocument(sessionId, sessionPath));
}
