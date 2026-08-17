import type { ConversationDocument, ConversationDocumentStore } from "@vetta/runtime-core/conversation";
import type { ConversationContinuationStore, ConversationRepository } from "@vetta/runtime-core/kernel";
import type { ConversationOwnershipHolder } from "./errors.js";

/** Platform-neutral ownership lease held for a conversation lifetime. */
export interface ConversationOwnershipLease {
	readonly conversationPath: string;
	readonly lockPath: string;
	readonly holder: ConversationOwnershipHolder;
	release(): Promise<void>;
}

/** Platform adapter responsible for acquiring exclusive conversation ownership. */
export interface ConversationOwnershipManager {
	acquire(conversationPath: string): Promise<ConversationOwnershipLease>;
}

/** Storage capabilities required by a runtime composition. */
export interface ConversationPersistence
	extends ConversationRepository,
		ConversationDocumentStore,
		ConversationContinuationStore {
	resolveConversationPath(sessionId: string): string;
	readDocument(sessionId: string): Promise<ConversationDocument>;
}

export type {
	ConversationDocument,
	ConversationDocumentCommand,
	ConversationDocumentCommandResult,
	ConversationDocumentForkResult,
	ConversationDocumentReader,
	ConversationDocumentStore,
} from "@vetta/runtime-core/conversation";
export type {
	AppendResult,
	ContinueConversationInput,
	ConversationContinuationResult,
	ConversationContinuationStore,
	ConversationMetadata,
	ConversationRepository,
	ConversationSnapshot,
	CreateConversationInput,
	StoredConversation,
	StoredSessionEvent,
} from "@vetta/runtime-core/kernel";
