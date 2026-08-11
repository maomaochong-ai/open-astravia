import { randomUUID } from "node:crypto";
import {
	applyConversationDocumentCommand,
	applyStoredEventToConversationDocument,
	type ConversationDocument,
	type ConversationDocumentCommand,
	type ConversationDocumentCommandResult,
	type ConversationDocumentEntry,
	type ConversationDocumentForkResult,
	type ConversationDocumentStore,
	conversationDocumentEntry,
	createEmptyConversationDocument,
	createSeededConversationDocument,
	extractConversationEntryText,
	resolveConversationUserTurnTip,
	selectConversationDocumentEntries,
	selectConversationDocumentModelMessages,
} from "@vetta/runtime-core/conversation";
import {
	type AppendResult,
	type ContinueConversationInput,
	type ConversationContinuationResult,
	type ConversationContinuationStore,
	type ConversationMetadata,
	type ConversationRepository,
	type ConversationSnapshot,
	type CreateConversationInput,
	FailInterruptedTurnRecoveryPolicy,
	type StoredConversation,
	type StoredSessionEvent,
} from "@vetta/runtime-core/kernel";
import { CONVERSATION_STORAGE_ERROR_CODES, ConversationStorageError } from "./errors.js";

/**
 * 进程内 Conversation 仓储。
 *
 * 它实现与文件仓储相同的 Kernel / Document / Continuation 端口，但不产生可恢复的
 * sessionPath。`resolveConversationPath` 仅返回供进程内组件关联身份的虚拟地址。
 */
export class InMemoryConversationRepository
	implements ConversationRepository, ConversationDocumentStore, ConversationContinuationStore
{
	private readonly conversations = new Map<string, StoredConversation>();
	private readonly documents = new Map<string, ConversationDocument>();
	private closed = false;

	resolveConversationPath(sessionId: string): string {
		return `memory://conversation/${encodeURIComponent(sessionId)}`;
	}

	async create(input: CreateConversationInput): Promise<ConversationMetadata> {
		this.assertOpen();
		if (this.conversations.has(input.sessionId)) {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.ALREADY_EXISTS,
				`Conversation already exists: ${input.sessionId}`,
			);
		}
		const conversation: StoredConversation = {
			sessionId: input.sessionId,
			createdAt: input.createdAt,
			version: 0,
			messages: [],
			events: [],
		};
		this.conversations.set(input.sessionId, conversation);
		this.documents.set(
			input.sessionId,
			createEmptyConversationDocument({
				sessionId: input.sessionId,
				createdAt: input.createdAt,
				cwd: input.cwd,
			}),
		);
		return conversation;
	}

	async load(sessionId: string): Promise<StoredConversation> {
		this.assertOpen();
		return this.requireConversation(sessionId);
	}

	async readDocument(sessionId: string): Promise<ConversationDocument> {
		this.assertOpen();
		return this.requireDocument(sessionId);
	}

	async execute(
		sessionId: string,
		expectedRevision: number | null,
		command: ConversationDocumentCommand,
	): Promise<ConversationDocumentCommandResult> {
		this.assertOpen();
		if (
			expectedRevision === null &&
			command.type !== "session.name.set" &&
			command.type !== "custom.append" &&
			command.type !== "entry.label.set"
		) {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.INVALID_COMMAND,
				`Command ${command.type} requires an expected conversation document revision`,
			);
		}
		const document = this.requireDocument(sessionId);
		if (expectedRevision !== null && document.revision !== expectedRevision) {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.DOCUMENT_VERSION_CONFLICT,
				`Conversation document ${sessionId} is at revision ${document.revision}, expected ${expectedRevision}`,
			);
		}
		const result = applyConversationDocumentCommand(document, command);
		if (!result.changed) return result;
		this.documents.set(sessionId, result.document);
		this.replaceConversationMessages(sessionId, result.document);
		return result;
	}

	async fork(sessionId: string, entryId: string): Promise<ConversationDocumentForkResult> {
		this.assertOpen();
		const source = this.requireDocument(sessionId);
		const selected = conversationDocumentEntry(source, entryId);
		const text = extractConversationEntryText(selected);
		const tipId = resolveConversationUserTurnTip(source, entryId);
		const entries = selectConversationDocumentEntries(source, tipId);
		const targetSessionId = randomUUID();
		const createdAt = Date.now();
		const document = createSeededConversationDocument(
			{
				sessionId: targetSessionId,
				createdAt,
				cwd: source.identity.cwd,
				parentEntryId: entryId,
			},
			entries,
			entries.at(-1)?.id ?? null,
		);
		this.documents.set(targetSessionId, document);
		this.conversations.set(targetSessionId, {
			sessionId: targetSessionId,
			createdAt,
			version: 0,
			messages: selectConversationDocumentModelMessages(document),
			events: [],
		});
		return { sessionId: targetSessionId, path: this.resolveConversationPath(targetSessionId), text };
	}

	async append(
		sessionId: string,
		expectedVersion: number,
		events: readonly StoredSessionEvent[],
	): Promise<AppendResult> {
		this.assertOpen();
		const conversation = this.requireConversation(sessionId);
		if (conversation.version !== expectedVersion) {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.VERSION_CONFLICT,
				`Conversation ${sessionId} is at version ${conversation.version}, expected ${expectedVersion}`,
			);
		}
		for (const event of events) {
			if (event.sessionId !== sessionId) {
				throw new ConversationStorageError(
					CONVERSATION_STORAGE_ERROR_CODES.INVALID_EVENT,
					`Event session ${event.sessionId} does not match ${sessionId}`,
				);
			}
		}
		let document = this.requireDocument(sessionId);
		for (const [index, event] of events.entries()) {
			document = applyStoredEventToConversationDocument(document, event, expectedVersion + index + 1);
		}
		const version = expectedVersion + events.length;
		this.documents.set(sessionId, document);
		this.conversations.set(sessionId, {
			...conversation,
			version,
			messages: selectConversationDocumentModelMessages(document),
			events: [...conversation.events, ...events],
		});
		return { version };
	}

	async continueConversation(input: ContinueConversationInput): Promise<ConversationContinuationResult> {
		this.assertOpen();
		const sourceConversation = this.requireConversation(input.sourceSessionId);
		if (sourceConversation.version !== input.expectedVersion) {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.VERSION_CONFLICT,
				`Conversation ${input.sourceSessionId} is at version ${sourceConversation.version}, expected ${input.expectedVersion}`,
			);
		}
		const recovery = new FailInterruptedTurnRecoveryPolicy().plan(sourceConversation);
		if (recovery.status !== "interrupt" || recovery.turnId !== input.turnId) {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.INVALID_COMMAND,
				`Conversation ${input.sourceSessionId} cannot continue inactive turn ${input.turnId}`,
			);
		}
		const carried = buildContinuationEntries(this.requireDocument(input.sourceSessionId));
		if (!carried) {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.INVALID_COMMAND,
				`Conversation ${input.sourceSessionId} has no compaction boundary to continue from`,
			);
		}
		const sessionId = randomUUID();
		const seedDocument = createSeededConversationDocument(
			{
				sessionId,
				createdAt: input.timestamp,
				cwd: this.requireDocument(input.sourceSessionId).identity.cwd,
				parentEntryId: carried.sourceEntryId,
			},
			carried.entries,
			carried.activeLeafId,
		);
		const seedConversation: StoredConversation = {
			sessionId,
			createdAt: input.timestamp,
			version: 0,
			messages: selectConversationDocumentModelMessages(seedDocument),
			events: [],
		};
		const transferredEvent = {
			type: "turn.transferred",
			sessionId: input.sourceSessionId,
			turnId: input.turnId,
			targetSessionId: sessionId,
			reason: input.reason,
			timestamp: input.timestamp,
		} as const;
		const continuedEvent = {
			type: "turn.continued",
			sessionId,
			turnId: input.turnId,
			sourceSessionId: input.sourceSessionId,
			snapshotId: input.snapshotId,
			reason: input.reason,
			timestamp: input.timestamp,
		} as const;
		this.conversations.set(input.sourceSessionId, {
			...sourceConversation,
			version: input.expectedVersion + 1,
			events: [...sourceConversation.events, transferredEvent],
		});
		this.documents.set(sessionId, seedDocument);
		this.conversations.set(sessionId, {
			...seedConversation,
			version: 1,
			events: [continuedEvent],
		});
		return {
			sourceSessionId: input.sourceSessionId,
			sourceVersion: input.expectedVersion + 1,
			sessionId,
			version: 1,
			seedConversation,
			seedDocument,
			transferredEvent,
			continuedEvent,
		};
	}

	async saveSnapshot(sessionId: string, snapshot: ConversationSnapshot): Promise<void> {
		this.assertOpen();
		const conversation = this.requireConversation(sessionId);
		if (snapshot.sessionId !== sessionId) {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.INVALID_EVENT,
				`Snapshot session ${snapshot.sessionId} does not match ${sessionId}`,
			);
		}
		if (snapshot.version !== conversation.version) {
			throw new ConversationStorageError(
				CONVERSATION_STORAGE_ERROR_CODES.VERSION_CONFLICT,
				`Snapshot version ${snapshot.version} does not match conversation version ${conversation.version}`,
			);
		}
	}

	async close(): Promise<void> {
		this.closed = true;
	}

	private replaceConversationMessages(sessionId: string, document: ConversationDocument): void {
		const conversation = this.requireConversation(sessionId);
		this.conversations.set(sessionId, {
			...conversation,
			messages: selectConversationDocumentModelMessages(document),
		});
	}

	private requireConversation(sessionId: string): StoredConversation {
		const conversation = this.conversations.get(sessionId);
		if (conversation) return conversation;
		throw new ConversationStorageError(
			CONVERSATION_STORAGE_ERROR_CODES.NOT_FOUND,
			`Conversation not found: ${sessionId}`,
		);
	}

	private requireDocument(sessionId: string): ConversationDocument {
		const document = this.documents.get(sessionId);
		if (document) return document;
		throw new ConversationStorageError(
			CONVERSATION_STORAGE_ERROR_CODES.NOT_FOUND,
			`Conversation document not found: ${sessionId}`,
		);
	}

	private assertOpen(): void {
		if (!this.closed) return;
		throw new ConversationStorageError(CONVERSATION_STORAGE_ERROR_CODES.CLOSED, "Conversation repository is closed");
	}
}

function buildContinuationEntries(document: ConversationDocument): {
	readonly sourceEntryId: string;
	readonly entries: readonly ConversationDocumentEntry[];
	readonly activeLeafId: string | null;
} | null {
	const branch = selectConversationDocumentEntries(document);
	let compactionIndex = -1;
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type === "compaction" && entry.summaryMessage) {
			compactionIndex = index;
			break;
		}
	}
	if (compactionIndex < 0) return null;
	const compaction = branch[compactionIndex];
	if (!compaction || compaction.type !== "compaction") return null;
	const firstKeptIndex = branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
	if (firstKeptIndex < 0 || firstKeptIndex >= compactionIndex) {
		throw new ConversationStorageError(
			CONVERSATION_STORAGE_ERROR_CODES.CORRUPT,
			`Conversation ${document.identity.sessionId} has an invalid compaction kept tail`,
		);
	}
	const carried = [compaction, ...branch.slice(firstKeptIndex, compactionIndex), ...branch.slice(compactionIndex + 1)];
	const targetIds = new Map(carried.map((entry, index) => [entry.id, `seed-${index + 1}`]));
	const entries: ConversationDocumentEntry[] = [];
	let parentId: string | null = null;
	for (const source of carried) {
		const id = targetIds.get(source.id);
		if (!id) throw new Error(`Continuation entry ID was not allocated for ${source.id}`);
		entries.push(rewriteContinuationEntry(source, id, parentId, targetIds));
		parentId = id;
	}
	const first = entries[0];
	if (!first || first.type !== "compaction") throw new Error("Continuation seed must start with a compaction entry");
	entries[0] = { ...first, firstKeptEntryId: entries[1]?.id ?? first.id };
	return {
		sourceEntryId: compaction.id,
		entries,
		activeLeafId: entries.at(-1)?.id ?? null,
	};
}

function rewriteContinuationEntry(
	entry: ConversationDocumentEntry,
	id: string,
	parentId: string | null,
	targetIds: ReadonlyMap<string, string>,
): ConversationDocumentEntry {
	switch (entry.type) {
		case "compaction":
			return { ...entry, id, parentId };
		case "branch_summary":
			return { ...entry, id, parentId, fromId: targetIds.get(entry.fromId) ?? entry.fromId };
		case "label":
			return { ...entry, id, parentId, targetId: targetIds.get(entry.targetId) ?? entry.targetId };
		case "tool_timing":
			return { ...entry, id, parentId, phases: [...entry.phases] };
		default:
			return { ...entry, id, parentId };
	}
}
