import type { ConversationDocumentStore } from "@vetta/runtime-core/conversation";
import type { ConversationContinuationStore, ConversationRepository } from "@vetta/runtime-core/kernel";
import { FileConversationRepository } from "./file-conversation-repository.js";
import { InMemoryConversationRepository } from "./in-memory-conversation-repository.js";

/** Node-owned persistence bundle consumed by a Runtime composition. */
export interface RuntimeNodeConversationPersistence {
	readonly repository: ConversationRepository;
	readonly documentStore: ConversationDocumentStore;
	readonly continuationStore: ConversationContinuationStore;
	resolveConversationPath(sessionId: string): string;
	resolveSessionDirectory(sessionId: string): string | undefined;
	resolveSessionPath(sessionId: string): string | undefined;
	assessSessionPath(sessionId: string, sessionPath: string): Promise<RuntimeNodeConversationSessionPathAssessment>;
	dispose(): Promise<void>;
}

export type RuntimeNodeConversationSessionPathAssessment = "valid" | "path-mismatch" | "missing" | "not-file";

export function createFileConversationPersistence(rootDir: string): RuntimeNodeConversationPersistence {
	const repository = new FileConversationRepository({ rootDir });
	return {
		repository,
		documentStore: repository,
		continuationStore: repository,
		resolveConversationPath: (sessionId) => repository.resolveConversationPath(sessionId),
		resolveSessionDirectory: (_sessionId) => repository.resolveSessionDirectory(),
		resolveSessionPath: (sessionId) => repository.resolveConversationPath(sessionId),
		assessSessionPath: (sessionId, sessionPath) =>
			assessFileConversationSessionPath(repository.resolveConversationPath(sessionId), sessionPath),
		dispose: () => repository.close(),
	};
}

export function createInMemoryConversationPersistence(): RuntimeNodeConversationPersistence {
	const repository = new InMemoryConversationRepository();
	return {
		repository,
		documentStore: repository,
		continuationStore: repository,
		resolveConversationPath: (sessionId) => repository.resolveConversationPath(sessionId),
		resolveSessionDirectory: (_sessionId) => undefined,
		resolveSessionPath: () => undefined,
		assessSessionPath: async () => "path-mismatch",
		dispose: () => repository.close(),
	};
}

async function assessFileConversationSessionPath(
	expectedSessionPath: string,
	sessionPath: string,
): Promise<RuntimeNodeConversationSessionPathAssessment> {
	const resolvedSessionPath = resolve(sessionPath);
	if (resolvedSessionPath !== resolve(expectedSessionPath)) return "path-mismatch";
	try {
		const metadata = await stat(resolvedSessionPath);
		return metadata.isFile() ? "valid" : "not-file";
	} catch {
		return "missing";
	}
}

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
