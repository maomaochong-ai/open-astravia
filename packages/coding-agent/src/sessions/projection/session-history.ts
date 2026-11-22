import type { Message, TextContent } from "@astravia/ai";
import type {
	AssistantTurnTiming,
	HistoryEntry,
	HistoryMessageBranch,
	PromptAttachmentRef,
	PromptResourceRef,
} from "@astravia/runtime-core";
import {
	PROMPT_ATTACHMENT_CONTEXT_TYPE,
	PROMPT_ATTACHMENT_REFERENCE_TYPE,
	PROMPT_RESOURCE_REFERENCE_TYPE,
} from "../../model-context/index.js";
import type {
	CodingAgentSessionEntry,
	CodingAgentSessionHeader,
	CodingAgentCustomEntry as CustomEntry,
} from "../contracts/session-entry.js";
import { ASSISTANT_TURN_TIMING_TYPE } from "../timing/assistant-turn-timing-participant.js";

type CodingSessionEntry = CodingAgentSessionEntry;
type FileEntry = CodingAgentSessionHeader | CodingAgentSessionEntry;

export { ASSISTANT_TURN_TIMING_TYPE };

/**
 * Reconstruct the leaf→root branch from a flat list of FileEntries (as
 * returned by loadEntriesFromFile). Mirrors what SessionManager.getBranch
 * does in-process but without instantiating SessionManager (which would
 * acquire the session-file lock).
 *
 * Strategy: find the most recent non-header entry that has no children,
 * then walk parentId back to the root. Order returned is root → leaf.
 */
export function branchFromFileEntries(entries: FileEntry[]): CodingSessionEntry[] {
	const byId = new Map<string, CodingSessionEntry>();
	const hasChild = new Set<string>();
	for (const e of entries) {
		if (e.type === "session") continue;
		const se = e as CodingSessionEntry;
		byId.set(se.id, se);
		if (se.parentId) hasChild.add(se.parentId);
	}
	let leafId: string | null = null;
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type === "session") continue;
		const se = e as CodingSessionEntry;
		if (!hasChild.has(se.id)) {
			leafId = se.id;
			break;
		}
	}
	const branch: CodingSessionEntry[] = [];
	let cur = leafId ? byId.get(leafId) : undefined;
	while (cur) {
		branch.unshift(cur);
		cur = cur.parentId ? byId.get(cur.parentId) : undefined;
	}
	return branch;
}

export function parseAssistantTurnTiming(entry: CustomEntry): AssistantTurnTiming | null {
	const data = entry.data;
	if (!data || typeof data !== "object") return null;
	const candidate = data as Record<string, unknown>;
	const { startedAt, endedAt, durationMs } = candidate;
	if (
		typeof startedAt !== "number" ||
		typeof endedAt !== "number" ||
		typeof durationMs !== "number" ||
		!Number.isFinite(startedAt) ||
		!Number.isFinite(endedAt) ||
		!Number.isFinite(durationMs)
	) {
		return null;
	}
	return { startedAt, endedAt, durationMs };
}

function parsePromptResourceRef(entry: CodingSessionEntry & { type: "custom_message" }): PromptResourceRef | null {
	const details = entry.details;
	if (details && typeof details === "object" && !Array.isArray(details)) {
		const candidate = (details as { promptRef?: unknown }).promptRef;
		if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
			const { kind, name } = candidate as { kind?: unknown; name?: unknown };
			// 旧会话里的 scene 引用按 skill 展示，场景功能已移除。
			if ((kind === "skill" || kind === "scene") && typeof name === "string" && name.trim()) {
				return { kind: "skill", name: name.trim() };
			}
		}
	}

	// Compatibility for sessions persisted before details.promptRef existed.
	const tag = entry.customType === "scene_expansion" ? "scene" : "skill";
	const match = typeof entry.content === "string" ? entry.content.match(new RegExp(`^<${tag} name="([^"]+)"`)) : null;
	return match?.[1] ? { kind: "skill", name: match[1] } : null;
}

function parsePromptAttachments(entry: CodingSessionEntry & { type: "custom_message" }): PromptAttachmentRef[] | null {
	const details = entry.details;
	if (!details || typeof details !== "object" || Array.isArray(details)) return null;
	const candidates = (details as { attachments?: unknown }).attachments;
	if (!Array.isArray(candidates)) return null;
	const attachments: PromptAttachmentRef[] = [];
	for (const candidate of candidates) {
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
		const { kind, path } = candidate as { kind?: unknown; path?: unknown };
		if ((kind === "file" || kind === "directory" || kind === "image") && typeof path === "string" && path.trim()) {
			attachments.push({ kind, path: path.trim() });
		}
	}
	return attachments;
}

function isUserMessageEntry(
	entry: CodingSessionEntry,
): entry is CodingSessionEntry & { type: "message"; message: { role: "user" } } {
	return entry.type === "message" && entry.message.role === "user";
}

/**
 * Entries that sit between structural turns (assistant/user) and the next user
 * message — skill expansion, model switches, etc. Skipping them finds the true
 * branch-point parent used when re-editing a user message.
 */
function isTransparentTreeEntry(entry: CodingSessionEntry): boolean {
	if (entry.type === "message") {
		const role = entry.message.role;
		// Only user/assistant/toolResult form structural conversation nodes.
		return role !== "user" && role !== "assistant" && role !== "toolResult";
	}
	if (entry.type === "compaction") return false;
	// custom / custom_message / model_change / thinking_level_change / label / tool_timing / branch_summary…
	return true;
}

/**
 * Walk up past transparent entries to the structural parent (assistant/user/compaction/null)
 * that defines the "edit branch point" for a user message.
 */
function getEditBranchParentId(
	entry: CodingSessionEntry,
	byId: Map<string, CodingSessionEntry>,
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
	// 链压缩：同一条透明节点链只走一次，长会话里的用户消息共用结果。
	if (memo) for (const id of path) memo.set(id, result);
	return result;
}

function _isAncestorOf(ancestorId: string, nodeId: string, byId: Map<string, CodingSessionEntry>): boolean {
	let cur = byId.get(nodeId);
	while (cur?.parentId) {
		if (cur.parentId === ancestorId) return true;
		cur = byId.get(cur.parentId);
	}
	return false;
}

/**
 * 一次建索引，供整份 history 复用。
 *
 * 旧实现对每个用户消息都重扫全部用户消息并逐条回溯父链，长会话（数百轮 + 多处编辑版本）
 * 下是 O(用户消息² × 链深)，实测 4800 条条目要 90 ms 以上，全部堵在 Electron 主线程上。
 * 这里把「用户消息 → 编辑分支父节点」预先算好并按父节点分桶，单个消息的查询变成哈希查找。
 */
type UserBranchIndex = {
	byId: Map<string, CodingSessionEntry>;
	byBranchParent: Map<string | null, CodingSessionEntry[]>;
	branchParentMemo: Map<string, string | null>;
};

function createUserBranchIndex(allEntries: CodingSessionEntry[]): UserBranchIndex {
	const byId = new Map<string, CodingSessionEntry>();
	for (const entry of allEntries) byId.set(entry.id, entry);
	const branchParentMemo = new Map<string, string | null>();
	const byBranchParent = new Map<string | null, CodingSessionEntry[]>();
	for (const entry of allEntries) {
		if (!isUserMessageEntry(entry)) continue;
		const key = getEditBranchParentId(entry, byId, branchParentMemo);
		const bucket = byBranchParent.get(key);
		if (bucket) bucket.push(entry);
		else byBranchParent.set(key, [entry]);
	}
	return { byId, byBranchParent, branchParentMemo };
}

/**
 * User-message versions that can be switched with ‹ i/n ›.
 *
 * Direct parentId matching fails when skill/settings custom messages sit between
 * the branch point and the user bubble. We group by structural edit-branch parent
 * and keep only "root" user messages of each alternative (not descendants of another
 * candidate).
 */
function buildUserBranch(entry: CodingSessionEntry, index: UserBranchIndex): HistoryMessageBranch | undefined {
	if (!isUserMessageEntry(entry)) return undefined;

	// 同一条透明节点链只走一次（索引里已缓存），这里直接拿桶。
	const branchParentId = getEditBranchParentId(entry, index.byId, index.branchParentMemo);
	const candidates = index.byBranchParent.get(branchParentId) ?? [];
	if (candidates.length === 0) return undefined;

	// Prefer direct same-parent siblings when available (fast path / no transparent nodes).
	const directKey = entry.parentId;
	const directSiblings = candidates.filter((u) => u.parentId === directKey);
	let versions: CodingSessionEntry[];
	if (directSiblings.length > 1) {
		versions = directSiblings;
	} else {
		// 桶内本来就是同一分支点的候选，祖先判定在桶内进行：避免对全量用户消息做 O(U²) 扫描。
		const candidateIds = new Set(candidates.map((candidate) => candidate.id));
		versions = candidates.filter((candidate) => !hasCandidateAncestor(candidate, candidateIds, index.byId));
	}

	versions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	const siblingIds = versions.map((v) => v.id);
	const position = siblingIds.indexOf(entry.id);
	if (position < 0) return undefined;
	return { siblings: siblingIds, index: position };
}

/** 沿父链向上，遇到同桶候选就成为它的后代（而不是并列版本）。 */
function hasCandidateAncestor(
	entry: CodingSessionEntry,
	candidateIds: Set<string>,
	byId: Map<string, CodingSessionEntry>,
): boolean {
	let cur = entry.parentId ? byId.get(entry.parentId) : undefined;
	while (cur) {
		if (cur.id !== entry.id && candidateIds.has(cur.id)) return true;
		cur = cur.parentId ? byId.get(cur.parentId) : undefined;
	}
	return false;
}

export type EntriesToHistoryOptions = {
	/**
	 * Full session entries (or at least all user messages) for sibling detection.
	 * When omitted, branch metadata is not attached.
	 */
	allEntries?: CodingSessionEntry[];
};

/** Translate a session branch (coding-agent entries) into host HistoryEntry[]. */
export function entriesToHistory(branch: CodingSessionEntry[], options?: EntriesToHistoryOptions): HistoryEntry[] {
	const allEntries = options?.allEntries;
	const branchIndex = allEntries ? createUserBranchIndex(allEntries) : undefined;

	const entries: HistoryEntry[] = [];
	for (const entry of branch) {
		if (entry.type === "message") {
			const msg = entry.message;
			if (msg.role === "user" || msg.role === "assistant" || msg.role === "toolResult") {
				const historyEntry: HistoryEntry = {
					type: "message",
					entryId: entry.id,
					parentId: entry.parentId,
					message: msg as Message,
				};
				if (branchIndex && msg.role === "user") {
					const branchInfo = buildUserBranch(entry, branchIndex);
					if (branchInfo) historyEntry.branch = branchInfo;
				}
				entries.push(historyEntry);
			}
		} else if (entry.type === "compaction") {
			entries.push({
				type: "compaction",
				entryId: entry.id,
				summary: entry.summary,
				tokensBefore: entry.tokensBefore,
				timestamp: entry.timestamp,
				...(entry.details === undefined ? {} : { details: entry.details }),
			});
		} else if (entry.type === "custom" && entry.customType === ASSISTANT_TURN_TIMING_TYPE) {
			const timing = parseAssistantTurnTiming(entry);
			if (timing) {
				entries.push({
					type: "assistant_turn_timing",
					timing,
					timestamp: entry.timestamp,
				});
			}
		} else if (entry.type === "custom_message" && entry.customType === PROMPT_RESOURCE_REFERENCE_TYPE) {
			const promptRef = parsePromptResourceRef(entry);
			if (promptRef) {
				entries.push({ type: "prompt_ref_marker", promptRef, timestamp: entry.timestamp });
			}
		} else if (
			entry.type === "custom_message" &&
			(entry.customType === PROMPT_ATTACHMENT_CONTEXT_TYPE || entry.customType === PROMPT_ATTACHMENT_REFERENCE_TYPE)
		) {
			const attachments = parsePromptAttachments(entry);
			if (attachments) {
				entries.push({ type: "prompt_attachments_marker", attachments, timestamp: entry.timestamp });
			}
		} else if (entry.type === "custom_message" && entry.customType === "settings_assist_instruction") {
			entries.push({
				type: "custom_marker",
				customType: entry.customType,
				...(entry.details === undefined ? {} : { details: entry.details }),
				timestamp: entry.timestamp,
			});
		} else if (
			entry.type === "custom_message" &&
			(entry.customType === "skill_expansion" || entry.customType === "scene_expansion")
		) {
			const promptRef = parsePromptResourceRef(entry);
			if (promptRef) {
				entries.push({ type: "prompt_ref_marker", promptRef, timestamp: entry.timestamp });
			}
		} else if (entry.type === "tool_timing") {
			entries.push({
				type: "tool_timing",
				toolCallId: entry.toolCallId,
				toolName: entry.toolName,
				startedAt: entry.startedAt,
				durationMs: entry.durationMs,
				phases: entry.phases,
				timestamp: entry.timestamp,
			});
		}
	}
	return entries;
}

export function extractAssistantText(content: Message["content"]): string {
	if (typeof content === "string") return content;
	return content
		.filter((item): item is TextContent => item.type === "text")
		.map((item) => item.text)
		.join("");
}
