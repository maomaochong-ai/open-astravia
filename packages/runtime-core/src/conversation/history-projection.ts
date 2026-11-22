import type { Message } from "@astravia/ai";
import type {
	AssistantTurnTiming,
	HistoryEntry,
	HistoryMessageBranch,
	PromptAttachmentRef,
	PromptResourceRef,
} from "../contracts.js";
import type { RuntimeFailureDetails, RuntimeFailureOrigin } from "../failure-contract.js";
import type {
	ConversationDocument,
	ConversationDocumentCustomEntry,
	ConversationDocumentCustomMessageEntry,
	ConversationDocumentEntry,
} from "./document.js";

const ASSISTANT_TURN_TIMING_TYPE = "astravia.assistant_turn_timing";
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
	const branchIndex = createUserBranchIndex(document.entries);
	const history: HistoryEntry[] = [];

	for (const entry of branch) {
		if (entry.type === "message") {
			if (entry.origin?.kind === "continuation") continue;
			if (!isHistoryMessage(entry.message)) continue;
			const historyEntry: HistoryEntry = {
				type: "message",
				entryId: entry.id,
				parentId: entry.parentId,
				...(entry.kind !== undefined || entry.turnId ? { turnId: entry.turnId } : {}),
				...(entry.kind === undefined && entry.messageId ? { messageId: entry.messageId } : {}),
				message: entry.message,
			};
			if (entry.message.role === "user") {
				const branchInfo = buildUserBranch(entry, branchIndex);
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
				...(entry.turnId === undefined ? {} : { turnId: entry.turnId }),
				timestamp: entry.timestamp,
				...(entry.details === undefined ? {} : { details: entry.details }),
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

function isVisibleUserMessageEntry(
	entry: ConversationDocumentEntry,
): entry is ConversationDocumentEntry & { readonly type: "message"; readonly message: Message & { role: "user" } } {
	return (
		entry.type === "message" &&
		entry.origin?.kind !== "continuation" &&
		isRecord(entry.message) &&
		entry.message.role === "user"
	);
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
	memo?: Map<string, string | null>,
): string | null {
	const path: string[] = [];
	let currentId = entry.parentId;
	let result: string | null = null;
	while (currentId) {
		if (memo) {
			const cached = memo.get(currentId);
			if (cached !== undefined) {
				result = cached;
				break;
			}
			path.push(currentId);
		}
		const parent = byId.get(currentId);
		if (!parent) {
			result = currentId;
			break;
		}
		if (!isTransparentTreeEntry(parent)) {
			result = currentId;
			break;
		}
		currentId = parent.parentId;
	}
	// 链压缩：同一条透明节点链只走一次。
	if (memo) for (const id of path) memo.set(id, result);
	return result;
}

/**
 * 整份 history 共用一份索引。
 *
 * 旧实现对每条用户消息都重扫全部用户消息并逐条回溯父链，长会话（数百轮 + 多处编辑）
 * 是 O(用户消息² × 链深)，而它跑在 Electron 主线程上；索引后单条消息的查询变成哈希查找。
 */
type UserBranchIndex = {
	byId: Map<string, ConversationDocumentEntry>;
	byBranchParent: Map<string | null, ConversationDocumentEntry[]>;
	branchParentMemo: Map<string, string | null>;
};

function createUserBranchIndex(entries: readonly ConversationDocumentEntry[]): UserBranchIndex {
	const byId = new Map<string, ConversationDocumentEntry>();
	for (const entry of entries) byId.set(entry.id, entry);
	const branchParentMemo = new Map<string, string | null>();
	const byBranchParent = new Map<string | null, ConversationDocumentEntry[]>();
	for (const entry of entries) {
		if (!isVisibleUserMessageEntry(entry)) continue;
		const key = structuralParentId(entry, byId, branchParentMemo);
		const bucket = byBranchParent.get(key);
		if (bucket) bucket.push(entry);
		else byBranchParent.set(key, [entry]);
	}
	return { byId, byBranchParent, branchParentMemo };
}

function _isAncestorOf(
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

function buildUserBranch(entry: ConversationDocumentEntry, index: UserBranchIndex): HistoryMessageBranch | undefined {
	const parentId = structuralParentId(entry, index.byId, index.branchParentMemo);
	const candidates = index.byBranchParent.get(parentId) ?? [];
	if (candidates.length === 0) return undefined;
	const directSiblings = candidates.filter((candidate) => candidate.parentId === entry.parentId);
	let versions: ConversationDocumentEntry[];
	if (directSiblings.length > 1) {
		versions = directSiblings;
	} else {
		// 祖先判定只在同一个分支点的桶内做，避免对全量用户消息 O(U²) 扫描。
		const candidateIds = new Set(candidates.map((candidate) => candidate.id));
		versions = candidates.filter((candidate) => !hasCandidateAncestor(candidate, candidateIds, index.byId));
	}
	versions.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
	const siblings = versions.map((candidate) => candidate.id);
	const position = siblings.indexOf(entry.id);
	return position < 0 ? undefined : { siblings, index: position };
}

/** 沿父链向上，遇到同桶候选就说明它是后代，而不是并列版本。 */
function hasCandidateAncestor(
	entry: ConversationDocumentEntry,
	candidateIds: Set<string>,
	byId: ReadonlyMap<string, ConversationDocumentEntry>,
): boolean {
	let current = entry.parentId ? byId.get(entry.parentId) : undefined;
	while (current) {
		if (current.id !== entry.id && candidateIds.has(current.id)) return true;
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return false;
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
	const retryable = typeof entry.data.error.retryable === "boolean" ? entry.data.error.retryable : undefined;
	const origin = parseFailureOrigin(entry.data.error.origin);
	const details = parseFailureDetails(entry.data.error.details);
	const turnId = typeof entry.data.turnId === "string" ? entry.data.turnId : undefined;
	history.push({
		type: "error",
		entryId: entry.id,
		code,
		...(retryable === undefined ? {} : { retryable }),
		...(origin === undefined ? {} : { origin }),
		...(details === undefined ? {} : { details }),
		message,
		timestamp: entry.timestamp,
		...(turnId ? { turnId } : {}),
	});
}

function parseFailureOrigin(value: unknown): RuntimeFailureOrigin | undefined {
	if (value === "runtime" || value === "provider" || value === "tool" || value === "extension") return value;
	// Historical/product-owned origins are normalized at the persistence boundary
	// instead of becoming permanent Runtime vocabulary.
	return typeof value === "string" && value.trim().length > 0 ? "extension" : undefined;
}

function parseFailureDetails(value: unknown): RuntimeFailureDetails | undefined {
	if (!isRecord(value)) return undefined;
	const details: {
		statusCode?: number;
		provider?: string;
		modelId?: string;
		requestId?: string;
		providerCode?: string;
		phase?: RuntimeFailureDetails["phase"];
		retryAfterMs?: number;
	} = {};
	if (typeof value.statusCode === "number" && Number.isFinite(value.statusCode)) details.statusCode = value.statusCode;
	if (typeof value.provider === "string" && value.provider.trim()) details.provider = value.provider.trim();
	if (typeof value.modelId === "string" && value.modelId.trim()) details.modelId = value.modelId.trim();
	if (typeof value.requestId === "string" && value.requestId.trim()) details.requestId = value.requestId.trim();
	if (typeof value.providerCode === "string" && value.providerCode.trim())
		details.providerCode = value.providerCode.trim();
	if (
		value.phase === "resolve" ||
		value.phase === "request" ||
		value.phase === "response" ||
		value.phase === "stream" ||
		value.phase === "decode"
	) {
		details.phase = value.phase;
	}
	if (typeof value.retryAfterMs === "number" && Number.isFinite(value.retryAfterMs))
		details.retryAfterMs = value.retryAfterMs;
	return Object.keys(details).length > 0 ? details : undefined;
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
	history.push({
		type: "custom_marker",
		customType: entry.customType,
		...(entry.details === undefined ? {} : { details: entry.details }),
		timestamp: entry.timestamp,
	});
}

function parsePromptResourceRef(entry: ConversationDocumentCustomMessageEntry): PromptResourceRef | undefined {
	if (isRecord(entry.details) && isRecord(entry.details.promptRef)) {
		const { kind, name } = entry.details.promptRef;
		if (typeof kind === "string" && kind.trim() && typeof name === "string" && name.trim()) {
			return { kind: kind.trim(), name: name.trim() };
		}
	}
	return undefined;
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
