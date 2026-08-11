import type { Message, TextContent } from "@vetta/ai";
import type {
	AssistantTurnTiming,
	HistoryEntry,
	HistoryMessageBranch,
	PromptAttachmentRef,
	PromptResourceRef,
} from "@vetta/runtime-core";
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

type CodingSessionEntry = CodingAgentSessionEntry;
type FileEntry = CodingAgentSessionHeader | CodingAgentSessionEntry;

export const ASSISTANT_TURN_TIMING_TYPE = "vetta.assistant_turn_timing";

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
			if ((kind === "skill" || kind === "scene") && typeof name === "string" && name.trim()) {
				return { kind, name: name.trim() };
			}
		}
	}

	// Compatibility for sessions persisted before details.promptRef existed.
	const kind = entry.customType === "scene_expansion" ? "scene" : "skill";
	const match = typeof entry.content === "string" ? entry.content.match(new RegExp(`^<${kind} name="([^"]+)"`)) : null;
	return match?.[1] ? { kind, name: match[1] } : null;
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
function getEditBranchParentId(entry: CodingSessionEntry, byId: Map<string, CodingSessionEntry>): string | null {
	let currentId = entry.parentId;
	while (currentId) {
		const parent = byId.get(currentId);
		if (!parent) return currentId;
		if (!isTransparentTreeEntry(parent)) {
			return currentId;
		}
		currentId = parent.parentId;
	}
	return null;
}

function isAncestorOf(ancestorId: string, nodeId: string, byId: Map<string, CodingSessionEntry>): boolean {
	let cur = byId.get(nodeId);
	while (cur?.parentId) {
		if (cur.parentId === ancestorId) return true;
		cur = byId.get(cur.parentId);
	}
	return false;
}

/**
 * User-message versions that can be switched with ‹ i/n ›.
 *
 * Direct parentId matching fails when skill/settings custom messages sit between
 * the branch point and the user bubble. We group by structural edit-branch parent
 * and keep only "root" user messages of each alternative (not descendants of another
 * candidate).
 */
function buildUserBranch(
	entry: CodingSessionEntry,
	byId: Map<string, CodingSessionEntry>,
	allUserEntries: CodingSessionEntry[],
): HistoryMessageBranch | undefined {
	if (!isUserMessageEntry(entry)) return undefined;

	const branchParentId = getEditBranchParentId(entry, byId);
	const candidates = allUserEntries.filter((u) => getEditBranchParentId(u, byId) === branchParentId);
	if (candidates.length === 0) return undefined;

	// Prefer direct same-parent siblings when available (fast path / no transparent nodes).
	const directKey = entry.parentId;
	const directSiblings = candidates.filter((u) => u.parentId === directKey);
	const versions =
		directSiblings.length > 1
			? directSiblings
			: candidates.filter(
					(m) => !candidates.some((other) => other.id !== m.id && isAncestorOf(other.id, m.id, byId)),
				);

	versions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	const siblingIds = versions.map((v) => v.id);
	const index = siblingIds.indexOf(entry.id);
	if (index < 0) return undefined;
	return { siblings: siblingIds, index };
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
	const byId = new Map<string, CodingSessionEntry>();
	const allUserEntries: CodingSessionEntry[] = [];
	if (allEntries) {
		for (const e of allEntries) {
			byId.set(e.id, e);
			if (isUserMessageEntry(e)) allUserEntries.push(e);
		}
	}

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
				if (allEntries && msg.role === "user") {
					const branchInfo = buildUserBranch(entry, byId, allUserEntries);
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
			// Model-only settings-assist preamble; surface a marker so the next user
			// bubble can show a page-specific badge after history reload.
			const details = entry.details;
			const tabId =
				details &&
				typeof details === "object" &&
				!Array.isArray(details) &&
				typeof (details as { tabId?: unknown }).tabId === "string"
					? (details as { tabId: string }).tabId.trim() || undefined
					: undefined;
			entries.push({
				type: "settings_assist_marker",
				tabId,
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
