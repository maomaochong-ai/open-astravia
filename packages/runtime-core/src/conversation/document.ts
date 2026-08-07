import type { ToolPhase } from "@vetta/agent-core";
import type { UserMessage } from "@vetta/ai";
import type { ContextCompactionRecord, StoredSessionEvent } from "../kernel/contracts.js";

export interface ConversationDocumentIdentity {
	readonly sessionId: string;
	readonly createdAt: number;
	readonly cwd?: string;
	readonly parentSessionPath?: string;
	readonly parentEntryId?: string;
}

export interface ConversationDocumentEntryBase {
	readonly id: string;
	readonly parentId: string | null;
	readonly timestamp: string;
}

export interface ConversationDocumentMessageEntry extends ConversationDocumentEntryBase {
	readonly type: "message";
	/** Legacy sessions may contain extension-specific AgentMessage variants. */
	readonly message: unknown;
}

export interface ConversationDocumentCompactionEntry extends ConversationDocumentEntryBase {
	readonly type: "compaction";
	readonly summary: string;
	readonly firstKeptEntryId: string;
	readonly tokensBefore: number;
	readonly details?: unknown;
	readonly fromHook?: boolean;
	/** Native records persist the exact model-visible summary message. */
	readonly summaryMessage?: UserMessage;
	readonly reason?: ContextCompactionRecord["reason"];
}

export interface ConversationDocumentBranchSummaryEntry extends ConversationDocumentEntryBase {
	readonly type: "branch_summary";
	readonly fromId: string;
	readonly summary: string;
	readonly details?: unknown;
	readonly fromHook?: boolean;
}

export interface ConversationDocumentCustomEntry extends ConversationDocumentEntryBase {
	readonly type: "custom";
	readonly customType: string;
	readonly data?: unknown;
}

export interface ConversationDocumentCustomMessageEntry extends ConversationDocumentEntryBase {
	readonly type: "custom_message";
	readonly customType: string;
	readonly content: unknown;
	readonly details?: unknown;
	readonly display: boolean;
	readonly modelVisible?: boolean;
}

export interface ConversationDocumentThinkingLevelEntry extends ConversationDocumentEntryBase {
	readonly type: "thinking_level_change";
	readonly thinkingLevel: string;
}

export interface ConversationDocumentModelEntry extends ConversationDocumentEntryBase {
	readonly type: "model_change";
	readonly provider: string;
	readonly modelId: string;
}

export interface ConversationDocumentLabelEntry extends ConversationDocumentEntryBase {
	readonly type: "label";
	readonly targetId: string;
	readonly label?: string;
}

export interface ConversationDocumentSessionInfoEntry extends ConversationDocumentEntryBase {
	readonly type: "session_info";
	readonly name?: string;
}

export interface ConversationDocumentToolTimingEntry extends ConversationDocumentEntryBase {
	readonly type: "tool_timing";
	readonly toolCallId: string;
	readonly toolName: string;
	readonly startedAt: number;
	readonly durationMs: number;
	readonly phases: readonly ToolPhase[];
}

export type ConversationDocumentEntry =
	| ConversationDocumentMessageEntry
	| ConversationDocumentCompactionEntry
	| ConversationDocumentBranchSummaryEntry
	| ConversationDocumentCustomEntry
	| ConversationDocumentCustomMessageEntry
	| ConversationDocumentThinkingLevelEntry
	| ConversationDocumentModelEntry
	| ConversationDocumentLabelEntry
	| ConversationDocumentSessionInfoEntry
	| ConversationDocumentToolTimingEntry;

export interface ConversationDocument {
	readonly identity: ConversationDocumentIdentity;
	/** Number of persisted Kernel events already applied to this read model. */
	readonly journalVersion: number;
	/** Optimistic document revision; advances for message entries and document commands. */
	readonly revision: number;
	readonly entries: readonly ConversationDocumentEntry[];
	readonly activeLeafId: string | null;
	readonly name?: string;
}

export interface ConversationDocumentEntryReference {
	readonly id: string;
	readonly parentId: string | null;
	readonly timestamp: string;
}

export interface ConversationDocumentReader {
	readDocument(sessionId: string): Promise<ConversationDocument>;
}

export function createEmptyConversationDocument(identity: ConversationDocumentIdentity): ConversationDocument {
	return { identity, journalVersion: 0, revision: 0, entries: [], activeLeafId: null };
}

/** 从经过 Storage 边界校验的续接 seed 重建目标 Conversation Document。 */
export function createSeededConversationDocument(
	identity: ConversationDocumentIdentity,
	entries: readonly ConversationDocumentEntry[],
	activeLeafId: string | null,
): ConversationDocument {
	assertConversationDocumentGraph(entries, activeLeafId);
	return {
		identity,
		journalVersion: 0,
		revision: entries.length,
		entries: [...entries],
		activeLeafId,
	};
}

/** 校验独立于持久化格式的 Conversation Document 图约束。 */
export function assertConversationDocumentGraph(
	entries: readonly ConversationDocumentEntry[],
	activeLeafId: string | null,
): void {
	const byId = new Map<string, ConversationDocumentEntry>();
	for (const entry of entries) {
		if (byId.has(entry.id)) throw new Error(`Conversation document entry already exists: ${entry.id}`);
		byId.set(entry.id, entry);
	}
	for (const entry of entries) {
		if (entry.parentId && !byId.has(entry.parentId)) {
			throw new Error(`Conversation document parent does not exist: ${entry.parentId}`);
		}
		const ancestors = new Set<string>([entry.id]);
		let parentId = entry.parentId;
		while (parentId) {
			if (ancestors.has(parentId)) throw new Error(`Conversation document contains a cycle at ${parentId}`);
			ancestors.add(parentId);
			parentId = byId.get(parentId)?.parentId ?? null;
		}
		if (entry.type === "branch_summary" && entry.fromId !== "root" && !byId.has(entry.fromId)) {
			throw new Error(`Conversation document branch summary source does not exist: ${entry.fromId}`);
		}
		if (entry.type === "label" && !byId.has(entry.targetId)) {
			throw new Error(`Conversation document label target does not exist: ${entry.targetId}`);
		}
		if (entry.type === "compaction") {
			if (!byId.has(entry.firstKeptEntryId)) {
				throw new Error(`Conversation document first kept entry does not exist: ${entry.firstKeptEntryId}`);
			}
			if (
				!isAncestorOrSelf(byId, entry.firstKeptEntryId, entry.id) &&
				!isAncestorOrSelf(byId, entry.id, entry.firstKeptEntryId)
			) {
				throw new Error(
					`Conversation document first kept entry is not on the same branch: ${entry.firstKeptEntryId}`,
				);
			}
		}
	}
	if (activeLeafId && !byId.has(activeLeafId)) {
		throw new Error(`Conversation document active leaf does not exist: ${activeLeafId}`);
	}
}

export function nativeConversationEntryId(sequence: number): string {
	return `event-${sequence}`;
}

/** Apply one persisted Kernel event to the independent conversation read model. */
export function applyStoredEventToConversationDocument(
	document: ConversationDocument,
	event: StoredSessionEvent,
	sequence: number,
	reference?: ConversationDocumentEntryReference,
): ConversationDocument {
	if (event.sessionId !== document.identity.sessionId) {
		throw new Error(`Conversation document ${document.identity.sessionId} cannot apply event for ${event.sessionId}`);
	}
	if (sequence !== document.journalVersion + 1) {
		throw new Error(`Conversation document journal sequence ${sequence} does not follow ${document.journalVersion}`);
	}
	if (
		event.type !== "message.appended" &&
		event.type !== "context.appended" &&
		event.type !== "context.recorded" &&
		!isPersistentCompactionEvent(event)
	) {
		return { ...document, journalVersion: sequence };
	}

	const entryReference =
		reference ??
		({
			id: nativeConversationEntryId(sequence),
			parentId: document.activeLeafId,
			timestamp: new Date(event.timestamp).toISOString(),
		} satisfies ConversationDocumentEntryReference);
	if (document.entries.some((entry) => entry.id === entryReference.id)) {
		throw new Error(`Conversation document entry already exists: ${entryReference.id}`);
	}
	if (entryReference.parentId && !document.entries.some((entry) => entry.id === entryReference.parentId)) {
		throw new Error(`Conversation document parent does not exist: ${entryReference.parentId}`);
	}
	if (isPersistentCompactionEvent(event)) {
		const activeBranchIds = new Set(selectBranchIds(document));
		if (!activeBranchIds.has(event.record.firstKeptEntryId)) {
			throw new Error(`Compaction first kept entry is not on the active branch: ${event.record.firstKeptEntryId}`);
		}
		return {
			...document,
			journalVersion: sequence,
			revision: document.revision + 1,
			entries: [
				...document.entries,
				{
					type: "compaction",
					...entryReference,
					summary: event.record.summary,
					summaryMessage: event.record.summaryMessage,
					firstKeptEntryId: event.record.firstKeptEntryId,
					tokensBefore: event.record.tokensBefore,
					details: event.record.details,
					fromHook: event.record.fromHook,
					reason: event.record.reason,
				},
			],
			activeLeafId: entryReference.id,
		};
	}
	return {
		...document,
		journalVersion: sequence,
		revision: document.revision + 1,
		entries: [
			...document.entries,
			event.type === "message.appended"
				? {
						type: "message",
						...entryReference,
						message: event.message,
					}
				: {
						type: "custom_message",
						...entryReference,
						customType: event.record.type,
						content: event.record.content,
						details: event.record.metadata,
						display: event.record.display ?? false,
						modelVisible: event.record.modelVisible,
					},
		],
		activeLeafId: entryReference.id,
	};
}

function isPersistentCompactionEvent(event: StoredSessionEvent): event is Extract<
	StoredSessionEvent,
	{ readonly type: "context.compacted" }
> & {
	readonly record: ContextCompactionRecord;
} {
	return event.type === "context.compacted" && "firstKeptEntryId" in event.record;
}

function selectBranchIds(document: ConversationDocument): readonly string[] {
	const byId = new Map(document.entries.map((entry) => [entry.id, entry]));
	const ids: string[] = [];
	let current = document.activeLeafId ? byId.get(document.activeLeafId) : undefined;
	while (current) {
		ids.unshift(current.id);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return ids;
}

function isAncestorOrSelf(
	byId: ReadonlyMap<string, ConversationDocumentEntry>,
	ancestorId: string,
	descendantId: string,
): boolean {
	let currentId: string | null = descendantId;
	while (currentId) {
		if (currentId === ancestorId) return true;
		currentId = byId.get(currentId)?.parentId ?? null;
	}
	return false;
}
