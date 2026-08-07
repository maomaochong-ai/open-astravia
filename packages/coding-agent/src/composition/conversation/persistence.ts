import type { ConversationDocumentStore } from "@vetta/runtime-core/conversation";
import type { ConversationContinuationStore, ConversationRepository } from "@vetta/runtime-core/kernel";
import { FileConversationRepository, InMemoryConversationRepository } from "@vetta/runtime-storage/conversation";

/** Composition 所需的完整 Conversation 持久化端口。 */
export interface CodingAgentConversationPersistence {
	readonly repository: ConversationRepository;
	readonly documentStore: ConversationDocumentStore;
	readonly continuationStore: ConversationContinuationStore;
	/** 供内部资源关联使用；内存实现可以返回虚拟地址。 */
	resolveConversationPath(sessionId: string): string;
	/** 对外暴露的可恢复会话路径；内存实现必须返回 undefined。 */
	resolveSessionPath(sessionId: string): string | undefined;
	dispose(): Promise<void>;
}

export interface CodingAgentConversationPersistenceFactoryContext {
	readonly conversationDir?: string;
}

export type CodingAgentConversationPersistenceFactory = (
	context: CodingAgentConversationPersistenceFactoryContext,
) => CodingAgentConversationPersistence | Promise<CodingAgentConversationPersistence>;

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
