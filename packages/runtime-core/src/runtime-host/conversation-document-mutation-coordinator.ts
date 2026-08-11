import type {
	ConversationDocument,
	ConversationDocumentCommand,
	ConversationDocumentCommandResult,
	ConversationDocumentStore,
} from "../conversation/index.js";

export interface ConversationDocumentMutationCoordinatorOptions {
	readonly readSessionId: () => string;
	readonly store: ConversationDocumentStore;
	readonly readProjectedDocument: () => ConversationDocument;
	readonly replaceProjectedDocument: (document: ConversationDocument) => void;
}

type DocumentCommandAttempt =
	| { readonly kind: "committed"; readonly result: ConversationDocumentCommandResult }
	| { readonly kind: "retry" };

/**
 * Serializes direct Conversation Document commands with persisted Journal projection updates.
 *
 * Repository revision checks remain authoritative. Projection refreshes read the persisted
 * document so Journal events and direct commands cannot be reconstructed from different bases.
 */
export class ConversationDocumentMutationCoordinator {
	private operationTail: Promise<void> = Promise.resolve();

	constructor(private readonly options: ConversationDocumentMutationCoordinatorOptions) {}

	async execute(command: ConversationDocumentCommand): Promise<ConversationDocumentCommandResult> {
		for (;;) {
			const attempt = await this.enqueue(() => this.attempt(command));
			if (attempt.kind === "committed") return attempt.result;
		}
	}

	async synchronizeProjection(): Promise<ConversationDocument> {
		return this.enqueue(() => this.readAndSynchronizeProjection());
	}

	async applyProjectionChange(change: () => void): Promise<void> {
		await this.enqueue(() => {
			change();
		});
	}

	private async attempt(command: ConversationDocumentCommand): Promise<DocumentCommandAttempt> {
		const sessionId = this.options.readSessionId();
		const document = await this.readAndSynchronizeProjection();

		try {
			const result = await this.options.store.execute(sessionId, document.revision, command);
			this.options.replaceProjectedDocument(result.document);
			return { kind: "committed", result };
		} catch (error) {
			const current = await this.options.store.readDocument(sessionId);
			if (current.revision === document.revision) throw error;
			return { kind: "retry" };
		}
	}

	private async readAndSynchronizeProjection(): Promise<ConversationDocument> {
		const sessionId = this.options.readSessionId();
		const document = await this.options.store.readDocument(sessionId);
		const projected = this.options.readProjectedDocument();
		if (document.journalVersion < projected.journalVersion || document.revision < projected.revision) {
			throw new Error(
				`Conversation document ${sessionId} is behind its projection ` +
					`(document=${document.revision}/${document.journalVersion}, ` +
					`projection=${projected.revision}/${projected.journalVersion})`,
			);
		}
		if (document.journalVersion !== projected.journalVersion || document.revision !== projected.revision) {
			this.options.replaceProjectedDocument(document);
		}
		return document;
	}

	private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
		const result = this.operationTail.then(operation);
		this.operationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}
