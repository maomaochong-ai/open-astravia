import type { Message } from "@vetta/ai";
import type {
	AssistantTurnTiming,
	HistoryEntry,
	HistoryMessageBranch,
	PromptAttachmentRef,
	PromptResourceRef,
} from "../contracts.js";
import type {
	ConversationDocument,
	ConversationDocumentCustomEntry,
	ConversationDocumentCustomMessageEntry,
	ConversationDocumentEntry,
} from "./document.js";

const ASSISTANT_TURN_TIMING_TYPE = "vetta.assistant_turn_timing";
const PROMPT_RESOURCE_REFERENCE_TYPE = "prompt_resource_reference";
const PROMPT_ATTACHMENT_CONTEXT_TYPE = "prompt_attachment_context";
const PROMPT_ATTACHMENT_REFERENCE_TYPE = "prompt_attachment_reference";
const PROMPT_REJECTED_TYPE = "prompt_rejected";
const TURN_FAILED_TYPE = "turn_failed";

export function selectConversationDocumentBranch(document: ConversationDocument): ConversationDocumentEntry[] {
	const byId = new Map(document.entries.map((entry) => [entry.id, entry]));
	const branch: ConversationDocumentEntry[] = [];
	let current = document.activeLeafId ? byId.get(document.activeLeafId) : undefined;
	while (current) {
		branch.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return branch;
}

export function projectConversationDocumentHistory(document: ConversationDocument): HistoryEntry[] {
	const branch = selectConversationDocumentBranch(document);
	const byId = new Map(document.entries.map((entry) => [entry.id, entry]));
	const allUserEntries = document.entries.filter(isUserMessageEntry);
	const history: HistoryEntry[] = [];

	for (const entry of branch) {
		if (entry.type === "message") {
			if (!isHistoryMessage(entry.message)) continue;
			const historyEntry: HistoryEntry = {
				type: "message",
				entryId: entry.id,
				parentId: entry.parentId,
				message: entry.message,
			};
			if (entry.message.role === "user") {
				const branchInfo = buildUserBranch(entry, byId, allUserEntries);
				if (branchInfo) historyEntry.branch = branchInfo;
			}
			history.push(historyEntry);
			continue;
		}
		if (entry.type === "compaction") {
			history.push({
				type: "compaction",
				entryId: entry.id,
				summary: entry.summary,
				tokensBefore: entry.tokensBefore,
				timestamp: entry.timestamp,
			});
			continue;
		}
		if (entry.type === "custom") {
			if (entry.customType === ASSISTANT_TURN_TIMING_TYPE) {
				const timing = parseAssistantTurnTiming(entry);
				if (timing) history.push({ type: "assistant_turn_timing", timing, timestamp: entry.timestamp });
				continue;
			}
			if (entry.customType === PROMPT_REJECTED_TYPE) {
				appendPromptRejectedHistory(history, entry);
				continue;
			}
			if (entry.customType === TURN_FAILED_TYPE) appendTurnFailedHistory(history, entry);
			continue;
		}
		if (entry.type === "custom_message") appendCustomMessageHistory(history, entry);
		if (entry.type === "tool_timing") {
			history.push({
				type: "tool_timing",
				toolCallId: entry.toolCallId,
				toolName: entry.toolName,
				startedAt: entry.startedAt,
				durationMs: entry.durationMs,
				phases: [...entry.phases],
				timestamp: entry.timestamp,
			});
		}
	}
	return history;
}

function isHistoryMessage(value: unknown): value is Message {
	if (!isRecord(value)) return false;
	return value.role === "user" || value.role === "assistant" || value.role === "toolResult";
}

function isUserMessageEntry(
	entry: ConversationDocumentEntry,
): entry is ConversationDocumentEntry & { readonly type: "message"; readonly message: Message & { role: "user" } } {
	return entry.type === "message" && isRecord(entry.message) && entry.message.role === "user";
}

function isTransparentTreeEntry(entry: ConversationDocumentEntry): boolean {
	if (entry.type === "message") {
		if (!isRecord(entry.message)) return true;
		return entry.message.role !== "user" && entry.message.role !== "assistant" && entry.message.role !== "toolResult";
	}
	return entry.type !== "compaction";
}

function structuralParentId(
	entry: ConversationDocumentEntry,
	byId: ReadonlyMap<string, ConversationDocumentEntry>,
): string | null {
	let currentId = entry.parentId;
	while (currentId) {
		const parent = byId.get(currentId);
		if (!parent) return currentId;
		if (!isTransparentTreeEntry(parent)) return currentId;
		currentId = parent.parentId;
	}
	return null;
}

function isAncestorOf(
	ancestorId: string,
	nodeId: string,
	byId: ReadonlyMap<string, ConversationDocumentEntry>,
): boolean {
	let current = byId.get(nodeId);
	while (current?.parentId) {
		if (current.parentId === ancestorId) return true;
		current = byId.get(current.parentId);
	}
	return false;
}

function buildUserBranch(
	entry: ConversationDocumentEntry,
	byId: ReadonlyMap<string, ConversationDocumentEntry>,
	allUserEntries: readonly ConversationDocumentEntry[],
): HistoryMessageBranch | undefined {
	const parentId = structuralParentId(entry, byId);
	const candidates = allUserEntries.filter((candidate) => structuralParentId(candidate, byId) === parentId);
	if (candidates.length === 0) return undefined;
	const directSiblings = candidates.filter((candidate) => candidate.parentId === entry.parentId);
	const versions =
		directSiblings.length > 1
			? directSiblings
			: candidates.filter(
					(candidate) =>
						!candidates.some((other) => other.id !== candidate.id && isAncestorOf(other.id, candidate.id, byId)),
				);
	versions.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
	const siblings = versions.map((candidate) => candidate.id);
	const index = siblings.indexOf(entry.id);
	return index < 0 ? undefined : { siblings, index };
}

function parseAssistantTurnTiming(entry: ConversationDocumentCustomEntry): AssistantTurnTiming | undefined {
	if (!isRecord(entry.data)) return undefined;
	const { startedAt, endedAt, durationMs } = entry.data;
	if (![startedAt, endedAt, durationMs].every((value) => typeof value === "number" && Number.isFinite(value))) {
		return undefined;
	}
	return { startedAt: startedAt as number, endedAt: endedAt as number, durationMs: durationMs as number };
}

function appendPromptRejectedHistory(history: HistoryEntry[], entry: ConversationDocumentCustomEntry): void {
	if (!isRecord(entry.data)) return;
	const text = typeof entry.data.text === "string" ? entry.data.text.trim() : "";
	const message = typeof entry.data.error === "string" ? entry.data.error.trim() : "";
	if (text) {
		history.push({
			type: "message",
			message: { role: "user", content: text, timestamp: new Date(entry.timestamp).getTime() },
		});
	}
	if (message) history.push({ type: "error", entryId: entry.id, message, timestamp: entry.timestamp });
}

function appendTurnFailedHistory(history: HistoryEntry[], entry: ConversationDocumentCustomEntry): void {
	if (!isRecord(entry.data) || !isRecord(entry.data.error)) return;
	const message = typeof entry.data.error.message === "string" ? entry.data.error.message.trim() : "";
	if (!message) return;
	const code = typeof entry.data.error.code === "string" ? entry.data.error.code : undefined;
	history.push({ type: "error", entryId: entry.id, code, message, timestamp: entry.timestamp });
}

function appendCustomMessageHistory(history: HistoryEntry[], entry: ConversationDocumentCustomMessageEntry): void {
	if (entry.customType === PROMPT_RESOURCE_REFERENCE_TYPE) {
		const promptRef = parsePromptResourceRef(entry);
		if (promptRef) history.push({ type: "prompt_ref_marker", promptRef, timestamp: entry.timestamp });
		return;
	}
	if (entry.customType === PROMPT_ATTACHMENT_CONTEXT_TYPE || entry.customType === PROMPT_ATTACHMENT_REFERENCE_TYPE) {
		const attachments = parsePromptAttachments(entry.details);
		if (attachments) history.push({ type: "prompt_attachments_marker", attachments, timestamp: entry.timestamp });
		return;
	}
	if (entry.customType === "settings_assist_instruction") {
		const tabId =
			isRecord(entry.details) && typeof entry.details.tabId === "string" ? entry.details.tabId.trim() : "";
		history.push({ type: "settings_assist_marker", tabId: tabId || undefined, timestamp: entry.timestamp });
		return;
	}
	if (entry.customType === "skill_expansion" || entry.customType === "scene_expansion") {
		const promptRef = parsePromptResourceRef(entry);
		if (promptRef) history.push({ type: "prompt_ref_marker", promptRef, timestamp: entry.timestamp });
	}
}

function parsePromptResourceRef(entry: ConversationDocumentCustomMessageEntry): PromptResourceRef | undefined {
	if (isRecord(entry.details) && isRecord(entry.details.promptRef)) {
		const { kind, name } = entry.details.promptRef;
		if ((kind === "skill" || kind === "scene") && typeof name === "string" && name.trim()) {
			return { kind, name: name.trim() };
		}
	}
	const kind = entry.customType === "scene_expansion" ? "scene" : "skill";
	const match = typeof entry.content === "string" ? entry.content.match(new RegExp(`^<${kind} name="([^"]+)"`)) : null;
	return match?.[1] ? { kind, name: match[1] } : undefined;
}

function parsePromptAttachments(value: unknown): PromptAttachmentRef[] | undefined {
	if (!isRecord(value) || !Array.isArray(value.attachments)) return undefined;
	const attachments: PromptAttachmentRef[] = [];
	for (const candidate of value.attachments) {
		if (!isRecord(candidate)) continue;
		const { kind, path } = candidate;
		if ((kind === "file" || kind === "directory" || kind === "image") && typeof path === "string" && path.trim()) {
			attachments.push({ kind, path: path.trim() });
		}
	}
	return attachments;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
