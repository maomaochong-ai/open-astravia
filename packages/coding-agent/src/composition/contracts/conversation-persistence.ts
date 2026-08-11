import type { ConversationDocumentStore } from "@vetta/runtime-core/conversation";
import type { ConversationContinuationStore, ConversationRepository } from "@vetta/runtime-core/kernel";

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
