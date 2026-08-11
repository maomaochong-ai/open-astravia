import { FileConversationRepository, InMemoryConversationRepository } from "@vetta/runtime-storage/conversation";
import type {
	CodingAgentConversationPersistence,
	CodingAgentConversationPersistenceFactory,
} from "../contracts/index.js";

export type {
	CodingAgentConversationPersistence,
	CodingAgentConversationPersistenceFactory,
	CodingAgentConversationPersistenceFactoryContext,
} from "../contracts/index.js";

export function createFileCodingAgentConversationPersistence(
	conversationDir: string,
): CodingAgentConversationPersistence {
	const repository = new FileConversationRepository({ rootDir: conversationDir });
	return {
		repository,
		documentStore: repository,
		continuationStore: repository,
		resolveConversationPath: (sessionId) => repository.resolveConversationPath(sessionId),
		resolveSessionPath: (sessionId) => repository.resolveConversationPath(sessionId),
		dispose: () => repository.close(),
	};
}

export function createInMemoryCodingAgentConversationPersistence(): CodingAgentConversationPersistence {
	const repository = new InMemoryConversationRepository();
	return {
		repository,
		documentStore: repository,
		continuationStore: repository,
		resolveConversationPath: (sessionId) => repository.resolveConversationPath(sessionId),
		resolveSessionPath: () => undefined,
		dispose: () => repository.close(),
	};
}

export async function resolveCodingAgentConversationPersistence(options: {
	readonly conversationDir?: string;
	readonly createConversationPersistence?: CodingAgentConversationPersistenceFactory;
}): Promise<CodingAgentConversationPersistence> {
	if (options.createConversationPersistence) {
		return options.createConversationPersistence({ conversationDir: options.conversationDir });
	}
	const conversationDir = options.conversationDir?.trim();
	if (!conversationDir) {
		throw new Error("Coding Agent Runtime requires conversationDir or createConversationPersistence");
	}
	return createFileCodingAgentConversationPersistence(conversationDir);
}
