import {
	type Api,
	type AssistantMessage,
	isContextOverflow,
	type Message,
	type Model,
	type UserMessage,
} from "@vetta/ai";
import {
	applyStoredEventToConversationDocument,
	type ConversationDocument,
	type ConversationDocumentEntry,
	selectConversationDocumentEntries,
	selectConversationDocumentModelMessages,
} from "@vetta/runtime-core/conversation";
import type { ContextCompactionRecord, ContextPreparationInput } from "@vetta/runtime-core/kernel";
import type { CodingAgentPinnedModelContext } from "../../runtime-contracts/index.js";
import type { CodingAgentSessionEntry as SessionEntry } from "../../sessions/index.js";
import { restoreCodingAgentSessionAgentMessageEntry } from "../../sessions/index.js";
import { projectPinnedConversationDocument } from "./pinned-conversation-projection.js";

export function toCompactionSessionEntries(document: ConversationDocument): SessionEntry[] {
	return selectConversationDocumentEntries(document).flatMap((entry) => {
		const converted = toSessionEntry(entry);
		return converted ? [converted] : [];
	});
}

/**
 * Reconstructs the model-visible history governed by the latest compaction marker.
 *
 * The persisted branch keeps the original entries before the marker for UI/history fidelity.
 * A later compaction must instead start from the latest summary plus that marker's retained
 * tail and any entries appended afterwards, otherwise same-Turn checkpoints repeatedly
 * compact the pre-compaction branch or lose the retained tail from the next summary.
 */
export function toActiveCompactionSessionEntries(document: ConversationDocument): SessionEntry[] {
	const entries = toCompactionSessionEntries(document);
	let latestCompactionIndex = -1;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		if (entries[index]?.type === "compaction") {
			latestCompactionIndex = index;
			break;
		}
	}
	if (latestCompactionIndex < 0) return entries;

	const latestCompaction = entries[latestCompactionIndex];
	if (!latestCompaction || latestCompaction.type !== "compaction") return entries;
	const firstKeptIndex = entries.findIndex(({ id }) => id === latestCompaction.firstKeptEntryId);
	if (firstKeptIndex < 0 || firstKeptIndex >= latestCompactionIndex) return entries;

	return [
		latestCompaction,
		...entries.slice(firstKeptIndex, latestCompactionIndex).filter((entry) => entry.type !== "compaction"),
		...entries.slice(latestCompactionIndex + 1),
	];
}

export function isOverflowFromCurrentModel(
	message: AssistantMessage | undefined,
	model: Model<Api>,
	contextWindow: number,
): boolean {
	return (
		message !== undefined &&
		message.provider === model.provider &&
		message.model === model.id &&
		isContextOverflow(message, contextWindow)
	);
}

export function removeAssistantMessage(
	messages: readonly Message[],
	triggeringMessage: AssistantMessage | undefined,
): Message[] {
	if (!triggeringMessage) return [...messages];
	const result = [...messages];
	for (let index = result.length - 1; index >= 0; index -= 1) {
		const message = result[index];
		if (message.role !== "assistant") continue;
		if (
			message === triggeringMessage ||
			(message.timestamp === triggeringMessage.timestamp &&
				message.provider === triggeringMessage.provider &&
				message.model === triggeringMessage.model &&
				message.stopReason === triggeringMessage.stopReason)
		) {
			result.splice(index, 1);
			break;
		}
	}
	return result;
}

export function assemblePreparedMessages(
	compactedHistory: readonly Message[],
	input: ContextPreparationInput,
	reason: NonNullable<ContextPreparationInput["reason"]>,
	compactionReason: "threshold" | "overflow",
	triggeringMessage: AssistantMessage | undefined,
): Message[] {
	if (reason === "turn_start") {
		return [...compactedHistory, ...input.messages.slice(input.historyMessages.length)];
	}

	const history =
		compactionReason === "overflow"
			? removeAssistantMessage(compactedHistory, triggeringMessage)
			: [...compactedHistory];
	const transientMessages = input.transientMessages ?? [];
	if (transientMessages.length === 0) return history;
	if (history.length === 0) return [...transientMessages];
	return [history[0], ...transientMessages, ...history.slice(1)];
}

export function projectCompactedHistory(
	document: ConversationDocument,
	sessionId: string,
	turnId: string,
	record: ContextCompactionRecord,
	pinnedContext?: CodingAgentPinnedModelContext,
): readonly Message[] {
	const sequence = document.journalVersion + 1;
	const projected = applyStoredEventToConversationDocument(
		document,
		{
			type: "context.compacted",
			sessionId,
			turnId,
			record,
			timestamp: record.summaryMessage.timestamp,
		},
		sequence,
		{
			id: `pending-compaction-${turnId}`,
			parentId: document.activeLeafId,
			timestamp: new Date(record.summaryMessage.timestamp).toISOString(),
		},
	);
	return selectConversationDocumentModelMessages(projectPinnedConversationDocument(projected, pinnedContext));
}

export function isRuntimeMessage(value: unknown): value is Message {
	if (!value || typeof value !== "object" || !("role" in value)) return false;
	return value.role === "user" || value.role === "assistant" || value.role === "toolResult";
}

function toSessionEntry(entry: ConversationDocumentEntry): SessionEntry | undefined {
	switch (entry.type) {
		case "message":
			return isRuntimeMessage(entry.message) ? { ...entry, message: entry.message } : undefined;
		case "compaction":
			return {
				type: "compaction",
				id: entry.id,
				parentId: entry.parentId,
				timestamp: entry.timestamp,
				summary: entry.summary,
				firstKeptEntryId: entry.firstKeptEntryId,
				tokensBefore: entry.tokensBefore,
				...(entry.details === undefined ? {} : { details: entry.details }),
				...(entry.fromHook === undefined ? {} : { fromHook: entry.fromHook }),
			};
		case "branch_summary":
			return {
				...entry,
				...(entry.details === undefined ? {} : { details: entry.details }),
				...(entry.fromHook === undefined ? {} : { fromHook: entry.fromHook }),
			};
		case "custom":
			return { ...entry };
		case "custom_message":
			return (
				restoreCodingAgentSessionAgentMessageEntry(entry) ??
				(entry.modelVisible === true && isUserContent(entry.content)
					? {
							type: "custom_message",
							id: entry.id,
							parentId: entry.parentId,
							timestamp: entry.timestamp,
							customType: entry.customType,
							content: entry.content,
							display: entry.display,
							...(entry.details === undefined ? {} : { details: entry.details }),
						}
					: undefined)
			);
		case "thinking_level_change":
		case "model_change":
		case "session_info":
			return { ...entry };
		case "label":
			return {
				type: "label",
				id: entry.id,
				parentId: entry.parentId,
				timestamp: entry.timestamp,
				targetId: entry.targetId,
				label: entry.label,
			};
		case "tool_timing":
			return { ...entry, phases: [...entry.phases] };
	}
}

function isUserContent(value: unknown): value is UserMessage["content"] {
	if (typeof value === "string") return true;
	if (!Array.isArray(value)) return false;
	return value.every((item) => {
		if (!item || typeof item !== "object" || !("type" in item)) return false;
		if (item.type === "text") return "text" in item && typeof item.text === "string";
		return (
			item.type === "image" &&
			"data" in item &&
			typeof item.data === "string" &&
			"mimeType" in item &&
			typeof item.mimeType === "string"
		);
	});
}
