import type { ConversationDocument, RuntimeMessageEnvelope } from "@vetta/runtime-core";
import { selectConversationDocumentEntries } from "@vetta/runtime-core/conversation";
import type { CodingAgentPinnedModelContext } from "../../runtime-contracts/index.js";

/** Uses the same entry projection for model calls and summary generation. */
function omitAssistantText<T>(message: T): T | undefined {
	if (typeof message !== "object" || message === null || !("role" in message) || message.role !== "assistant")
		return message;
	if (!("content" in message) || !Array.isArray(message.content)) return message;
	const content = message.content.filter(
		(block: unknown) => typeof block !== "object" || block === null || !("type" in block) || block.type !== "text",
	);
	return content.length > 0 ? { ...message, content } : undefined;
}

export function projectPinnedMessageEnvelopes(
	envelopes: readonly RuntimeMessageEnvelope[],
	context: CodingAgentPinnedModelContext | undefined,
): RuntimeMessageEnvelope[] {
	const projections = new Map(context?.conversationProjections?.map(({ entryId, kind }) => [entryId, kind]));
	return envelopes.flatMap((envelope): RuntimeMessageEnvelope[] => {
		const kind = envelope.entryId ? projections.get(envelope.entryId) : undefined;
		if (kind === "omit-entry") return [];
		if (kind !== "omit-assistant-text" || envelope.kind !== "message") return [envelope];
		const message = omitAssistantText(envelope.message);
		return message ? [{ ...envelope, message }] : [];
	});
}

/** Reparents only the projected view; the canonical document and its tool chains remain intact. */
export function projectPinnedConversationDocument(
	document: ConversationDocument,
	context: CodingAgentPinnedModelContext | undefined,
): ConversationDocument {
	if (!context?.conversationProjections?.length) return document;
	const projections = new Map(context.conversationProjections.map(({ entryId, kind }) => [entryId, kind]));
	const omittedParents = new Map<string, string | null>();
	const entries = document.entries.flatMap((entry): ConversationDocument["entries"][number][] => {
		const kind = projections.get(entry.id);
		if (kind === "omit-entry") {
			omittedParents.set(entry.id, entry.parentId);
			return [];
		}
		if (kind !== "omit-assistant-text" || entry.type !== "message" || entry.kind === "user") return [entry];
		if (entry.kind === "agent") {
			const message = omitAssistantText(entry.message);
			if (message) return [{ ...entry, message }];
		} else {
			const message = omitAssistantText(entry.message);
			if (message !== undefined) return [{ ...entry, message }];
		}
		omittedParents.set(entry.id, entry.parentId);
		return [];
	});
	const resolveParent = (parentId: string | null): string | null => {
		const visited = new Set<string>();
		let current = parentId;
		while (current && omittedParents.has(current)) {
			if (visited.has(current)) throw new Error(`Conversation entry parent cycle: ${current}`);
			visited.add(current);
			current = omittedParents.get(current) ?? null;
		}
		return current;
	};
	return {
		...document,
		activeLeafId: resolveParent(document.activeLeafId),
		entries: entries.map((entry) => {
			const parentId = resolveParent(entry.parentId);
			if (entry.type !== "compaction" || !omittedParents.has(entry.firstKeptEntryId)) return { ...entry, parentId };
			const branch = selectConversationDocumentEntries(document, entry.id);
			const boundary = branch.findIndex(({ id }) => id === entry.firstKeptEntryId);
			if (boundary < 0) throw new Error(`Compaction first kept entry does not exist: ${entry.firstKeptEntryId}`);
			const firstKeptEntryId = branch.slice(boundary + 1).find(({ id }) => !omittedParents.has(id))?.id ?? entry.id;
			return { ...entry, parentId, firstKeptEntryId };
		}),
	};
}
