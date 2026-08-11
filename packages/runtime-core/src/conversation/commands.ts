import type { Message, UserMessage } from "@vetta/ai";
import type { ConversationDocument, ConversationDocumentEntry } from "./document.js";

export type ConversationDocumentCommand =
	| { readonly type: "active_leaf.set"; readonly entryId: string | null }
	| { readonly type: "branch.select"; readonly entryId: string }
	| { readonly type: "message.delete"; readonly entryId: string }
	| { readonly type: "user_turn.replace"; readonly entryId: string }
	| {
			readonly type: "branch_summary.append";
			readonly entryId: string;
			readonly parentId: string | null;
			readonly summary: string;
			readonly details?: unknown;
			readonly fromHook?: boolean;
			readonly timestamp: string;
	  }
	| {
			readonly type: "custom.append";
			readonly entryId: string;
			readonly customType: string;
			readonly data?: unknown;
			readonly timestamp: string;
	  }
	| { readonly type: "session.name.set"; readonly name: string }
	| {
			readonly type: "entry.label.set";
			readonly entryId: string;
			readonly targetId: string;
			readonly label?: string;
			readonly timestamp: string;
	  };

export interface ConversationDocumentCommandResult {
	readonly document: ConversationDocument;
	readonly changed: boolean;
	readonly leafId: string | null;
}

export interface ConversationDocumentForkResult {
	readonly sessionId: string;
	readonly path: string;
	readonly text: string;
}

export interface ConversationDocumentStore {
	readDocument(sessionId: string): Promise<ConversationDocument>;
	execute(
		sessionId: string,
		/** `null` is reserved for append-only metadata commands that apply to the latest revision. */
		expectedRevision: number | null,
		command: ConversationDocumentCommand,
	): Promise<ConversationDocumentCommandResult>;
	fork(sessionId: string, entryId: string): Promise<ConversationDocumentForkResult>;
}

export function applyConversationDocumentCommand(
	document: ConversationDocument,
	command: ConversationDocumentCommand,
	revision = document.revision + 1,
): ConversationDocumentCommandResult {
	if (revision !== document.revision + 1) {
		throw new Error(`Conversation document revision ${revision} does not follow ${document.revision}`);
	}
	switch (command.type) {
		case "active_leaf.set":
			return setActiveLeaf(document, command.entryId, revision);
		case "branch.select":
			return setActiveLeaf(document, resolveSubtreeTip(document.entries, command.entryId), revision);
		case "message.delete":
			return deleteMessage(document, command.entryId, revision);
		case "user_turn.replace":
			return replaceLastUserTurn(document, command.entryId, revision);
		case "branch_summary.append":
			return appendBranchSummaryEntry(document, command, revision);
		case "custom.append":
			return appendCustomEntry(document, command, revision);
		case "session.name.set":
			return changed({ ...document, revision, name: command.name.trim() });
		case "entry.label.set":
			return appendLabelEntry(document, command, revision);
	}
}

export function conversationDocumentEntry(document: ConversationDocument, entryId: string): ConversationDocumentEntry {
	const entry = document.entries.find((candidate) => candidate.id === entryId);
	if (!entry) throw new Error(`Entry ${entryId} not found`);
	return entry;
}

export function extractConversationEntryText(entry: ConversationDocumentEntry): string {
	if (entry.type === "message") {
		if (!isRecord(entry.message) || entry.message.role !== "user") return "";
		return extractText(entry.message.content);
	}
	return entry.type === "custom_message" ? extractText(entry.content) : "";
}

export function resolveConversationUserTurnTip(document: ConversationDocument, entryId: string): string {
	const entry = conversationDocumentEntry(document, entryId);
	if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "user") {
		throw new Error(`Entry ${entryId} is not a user message`);
	}
	let tipId = entryId;
	for (;;) {
		const children = childrenOf(document.entries, tipId)
			.filter((candidate) => candidate.type !== "label")
			.filter(
				(candidate) =>
					candidate.type !== "message" || !isRecord(candidate.message) || candidate.message.role !== "user",
			)
			.sort(byTimestamp);
		if (children.length === 0) return tipId;
		tipId = children[children.length - 1]?.id ?? tipId;
	}
}

export function selectConversationDocumentMessages(document: ConversationDocument): readonly Message[] {
	return selectBranch(document.entries, document.activeLeafId).flatMap((entry) => {
		if (entry.type !== "message" || !isMessage(entry.message)) return [];
		return [entry.message];
	});
}

/** 选择活动分支上提供给模型的标准消息与显式可见上下文。 */
export function selectConversationDocumentModelMessages(document: ConversationDocument): readonly Message[] {
	const branch = selectBranch(document.entries, document.activeLeafId);
	let compactionIndex = -1;
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry?.type === "compaction" && entry.summaryMessage !== undefined) {
			compactionIndex = index;
			break;
		}
	}
	if (compactionIndex < 0) return branch.flatMap(projectModelMessages);

	const compaction = branch[compactionIndex];
	if (compaction.type !== "compaction" || !compaction.summaryMessage) return branch.flatMap(projectModelMessages);
	const firstKeptIndex = branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
	if (firstKeptIndex < 0)
		throw new Error(`Compaction first kept entry does not exist: ${compaction.firstKeptEntryId}`);
	if (firstKeptIndex > compactionIndex) {
		return [compaction.summaryMessage, ...branch.slice(firstKeptIndex).flatMap(projectModelMessages)];
	}
	return [
		compaction.summaryMessage,
		...branch.slice(firstKeptIndex, compactionIndex).flatMap(projectModelMessages),
		...branch.slice(compactionIndex + 1).flatMap(projectModelMessages),
	];
}

export function selectConversationDocumentEntries(
	document: ConversationDocument,
	leafId: string | null = document.activeLeafId,
): readonly ConversationDocumentEntry[] {
	return selectBranch(document.entries, leafId);
}

function setActiveLeaf(
	document: ConversationDocument,
	entryId: string | null,
	revision: number,
): ConversationDocumentCommandResult {
	if (entryId && !document.entries.some((entry) => entry.id === entryId)) {
		throw new Error(`Entry ${entryId} not found`);
	}
	if (document.activeLeafId === entryId) return unchanged(document);
	return changed({ ...document, revision, activeLeafId: entryId });
}

function deleteMessage(
	document: ConversationDocument,
	entryId: string,
	revision: number,
): ConversationDocumentCommandResult {
	const entry = conversationDocumentEntry(document, entryId);
	if (entry.type !== "message") throw new Error(`Entry ${entryId} is not a message`);
	const removedIds = new Set<string>([entryId]);
	for (const candidate of document.entries) {
		if (candidate.type === "label" && candidate.targetId === entryId) removedIds.add(candidate.id);
	}
	return changed(rewriteAfterRemoval(document, removedIds, revision));
}

function replaceLastUserTurn(
	document: ConversationDocument,
	entryId: string,
	revision: number,
): ConversationDocumentCommandResult {
	const entry = conversationDocumentEntry(document, entryId);
	if (entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "user") {
		throw new Error(`Entry ${entryId} is not a user message`);
	}
	const lastUser = [...selectBranch(document.entries, document.activeLeafId)]
		.reverse()
		.find(
			(candidate) =>
				candidate.type === "message" && isRecord(candidate.message) && candidate.message.role === "user",
		);
	if (lastUser?.id !== entryId) {
		throw new Error(`Entry ${entryId} is not the last user message on the active branch`);
	}

	const childrenByParent = new Map<string, string[]>();
	for (const candidate of document.entries) {
		if (!candidate.parentId) continue;
		const children = childrenByParent.get(candidate.parentId) ?? [];
		children.push(candidate.id);
		childrenByParent.set(candidate.parentId, children);
	}
	const removedIds = new Set<string>();
	const stack = [entryId];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current || removedIds.has(current)) continue;
		removedIds.add(current);
		stack.push(...(childrenByParent.get(current) ?? []));
	}
	for (const candidate of document.entries) {
		if (candidate.type === "label" && removedIds.has(candidate.targetId)) removedIds.add(candidate.id);
	}
	const rewritten = rewriteAfterRemoval(document, removedIds, revision);
	return changed({
		...rewritten,
		activeLeafId:
			entry.parentId && rewritten.entries.some((candidate) => candidate.id === entry.parentId)
				? entry.parentId
				: null,
	});
}

function appendCustomEntry(
	document: ConversationDocument,
	command: Extract<ConversationDocumentCommand, { readonly type: "custom.append" }>,
	revision: number,
): ConversationDocumentCommandResult {
	if (document.entries.some((entry) => entry.id === command.entryId)) {
		throw new Error(`Conversation document entry already exists: ${command.entryId}`);
	}
	return changed({
		...document,
		revision,
		entries: [
			...document.entries,
			{
				type: "custom",
				id: command.entryId,
				parentId: document.activeLeafId,
				timestamp: command.timestamp,
				customType: command.customType,
				data: command.data,
			},
		],
		activeLeafId: command.entryId,
	});
}

function appendBranchSummaryEntry(
	document: ConversationDocument,
	command: Extract<ConversationDocumentCommand, { readonly type: "branch_summary.append" }>,
	revision: number,
): ConversationDocumentCommandResult {
	if (document.entries.some((entry) => entry.id === command.entryId)) {
		throw new Error(`Conversation document entry already exists: ${command.entryId}`);
	}
	if (command.parentId && !document.entries.some((entry) => entry.id === command.parentId)) {
		throw new Error(`Entry ${command.parentId} not found`);
	}
	return changed({
		...document,
		revision,
		entries: [
			...document.entries,
			{
				type: "branch_summary",
				id: command.entryId,
				parentId: command.parentId,
				timestamp: command.timestamp,
				fromId: command.parentId ?? "root",
				summary: command.summary,
				details: command.details,
				fromHook: command.fromHook,
			},
		],
		activeLeafId: command.entryId,
	});
}

function appendLabelEntry(
	document: ConversationDocument,
	command: Extract<ConversationDocumentCommand, { readonly type: "entry.label.set" }>,
	revision: number,
): ConversationDocumentCommandResult {
	if (document.entries.some((entry) => entry.id === command.entryId)) {
		throw new Error(`Conversation document entry already exists: ${command.entryId}`);
	}
	if (!document.entries.some((entry) => entry.id === command.targetId)) {
		throw new Error(`Entry ${command.targetId} not found`);
	}
	return changed({
		...document,
		revision,
		entries: [
			...document.entries,
			{
				type: "label",
				id: command.entryId,
				parentId: document.activeLeafId,
				timestamp: command.timestamp,
				targetId: command.targetId,
				label: command.label,
			},
		],
		activeLeafId: command.entryId,
	});
}

function rewriteAfterRemoval(
	document: ConversationDocument,
	removedIds: ReadonlySet<string>,
	revision: number,
): ConversationDocument {
	const byId = new Map(document.entries.map((entry) => [entry.id, entry]));
	const resolveParent = (parentId: string | null): string | null => {
		let current = parentId;
		while (current && removedIds.has(current)) current = byId.get(current)?.parentId ?? null;
		return current;
	};
	const firstKeptReplacements = new Map<string, string>();
	for (const candidate of document.entries) {
		if (candidate.type !== "compaction" || !removedIds.has(candidate.firstKeptEntryId)) continue;
		const path = selectBranch(document.entries, candidate.id);
		const removedIndex = path.findIndex((entry) => removedIds.has(entry.id));
		const replacement = path.slice(removedIndex + 1).find((entry) => !removedIds.has(entry.id));
		firstKeptReplacements.set(candidate.id, replacement?.id ?? candidate.id);
	}
	const entries = document.entries
		.filter((entry) => !removedIds.has(entry.id))
		.map((entry): ConversationDocumentEntry => {
			const parentId = resolveParent(entry.parentId);
			let next = parentId === entry.parentId ? entry : ({ ...entry, parentId } as ConversationDocumentEntry);
			if (next.type === "branch_summary" && removedIds.has(next.fromId)) {
				next = { ...next, fromId: resolveParent(next.fromId) ?? "root" };
			}
			const firstKeptEntryId = firstKeptReplacements.get(next.id);
			if (next.type === "compaction" && firstKeptEntryId) {
				next = { ...next, firstKeptEntryId };
			}
			return next;
		});
	const activeLeafId =
		document.activeLeafId && !removedIds.has(document.activeLeafId)
			? document.activeLeafId
			: resolveParent(document.activeLeafId);
	return { ...document, revision, entries, activeLeafId };
}

function resolveSubtreeTip(entries: readonly ConversationDocumentEntry[], entryId: string): string {
	if (!entries.some((entry) => entry.id === entryId)) throw new Error(`Entry ${entryId} not found`);
	let tipId = entryId;
	for (;;) {
		const children = childrenOf(entries, tipId)
			.filter((entry) => entry.type !== "label")
			.sort(byTimestamp);
		if (children.length === 0) return tipId;
		tipId = children[children.length - 1]?.id ?? tipId;
	}
}

function selectBranch(
	entries: readonly ConversationDocumentEntry[],
	leafId: string | null,
): ConversationDocumentEntry[] {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const branch: ConversationDocumentEntry[] = [];
	let current = leafId ? byId.get(leafId) : undefined;
	while (current) {
		branch.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return branch;
}

function childrenOf(entries: readonly ConversationDocumentEntry[], parentId: string): ConversationDocumentEntry[] {
	return entries.filter((entry) => entry.parentId === parentId);
}

function byTimestamp(left: ConversationDocumentEntry, right: ConversationDocumentEntry): number {
	return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
}

function extractText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.filter((item): item is { readonly type: "text"; readonly text: string } => {
			return isRecord(item) && item.type === "text" && typeof item.text === "string";
		})
		.map((item) => item.text)
		.join("");
}

function projectModelMessages(entry: ConversationDocumentEntry): readonly Message[] {
	if (entry.type === "message" && isMessage(entry.message)) return [entry.message];
	if (entry.type !== "custom_message" || entry.modelVisible !== true || !isUserMessageContent(entry.content)) {
		return [];
	}
	return [
		{
			role: "user",
			content: entry.content,
			timestamp: new Date(entry.timestamp).getTime(),
		} satisfies UserMessage,
	];
}

function isMessage(value: unknown): value is Message {
	if (!isRecord(value)) return false;
	return value.role === "user" || value.role === "assistant" || value.role === "toolResult";
}

function isUserMessageContent(value: unknown): value is UserMessage["content"] {
	if (typeof value === "string") return true;
	if (!Array.isArray(value)) return false;
	return value.every((item) => {
		if (!isRecord(item) || typeof item.type !== "string") return false;
		if (item.type === "text") return typeof item.text === "string";
		return item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string";
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function changed(document: ConversationDocument): ConversationDocumentCommandResult {
	return { document, changed: true, leafId: document.activeLeafId };
}

function unchanged(document: ConversationDocument): ConversationDocumentCommandResult {
	return { document, changed: false, leafId: document.activeLeafId };
}
