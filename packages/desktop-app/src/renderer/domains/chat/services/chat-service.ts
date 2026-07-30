import { isAttachmentPath, isImagePath } from "@shared/lib/input-tokens";
import { pathBasename } from "@shared/lib/utils";
import type {
	AskUserQuestionResolution,
	ChatMessage,
	ContentBlock,
	KnowledgeToolUiDetails,
	ToolCallBlock,
	ToolCallUiDetails,
	ToolImagePreview,
} from "@shared/store/atoms";
import type { CardDescriptor } from "@vetta-org/plugin-sdk";
import type { HistoryEntry, PromptAttachmentRef, PromptResourceRef } from "../../../../../../runtime-core/src/index.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Message conversion helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Extract plain text from a message content (string or content-part array). */
export function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return (content as Array<{ type: string; text?: string }>)
		.filter((p) => p.type === "text" && typeof p.text === "string")
		.map((p) => p.text!)
		.join("");
}

/** Extract text from an array of result content blocks. */
export function extractResultText(result: unknown): string {
	if (typeof result === "string") return result;
	if (result && typeof result === "object" && "content" in result) {
		const r = result as { content?: Array<{ type: string; text?: string }> };
		return (r.content ?? [])
			.filter((c) => c.type === "text" && c.text)
			.map((c) => c.text!)
			.join("\n");
	}
	return "";
}

/**
 * Attachment prefixes written by the client always use absolute paths:
 * - @panel / drag-drop / explorer → absolute workspace path
 * - persistImages / appshot → absolute path under image-cache
 * Hand-typed "@foo" or "@src/bar.ts" (relative / non-path) must stay in the body.
 */
export const isUserMessageAttachmentPath = isAttachmentPath;

/** System-injected attachment paths (images / appshot), not panel file badges. */
export function isSystemAttachmentPath(path: string): boolean {
	return /[/\\]image-cache[/\\]/.test(path);
}

export const isUserImageFile = isImagePath;

/**
 * Parse prefixes from user message text: /skill:<name>, /scene:<name>, and @<path> lines.
 * Each @ line must end with a literal newline AND look like an absolute attachment path;
 * hand-typed "@something" / "@rel/path" is kept in the body (not a file badge).
 */
export function parseUserPrefixes(text: string): {
	skillName: string | null;
	skillType: "skill" | "scene" | null;
	files: string[];
	body: string;
} {
	let remaining = text;
	let skillName: string | null = null;
	let skillType: "skill" | "scene" | null = null;
	const files: string[] = [];

	const skillMatch = remaining.match(/^\/(skill|scene):([^\n]+)\n?([\s\S]*)$/);
	if (skillMatch) {
		skillType = skillMatch[1] as "skill" | "scene";
		skillName = skillMatch[2].trim();
		remaining = skillMatch[3];
	}

	while (true) {
		const fileMatch = remaining.match(/^@([^\n]+)\n([\s\S]*)$/);
		if (!fileMatch) break;
		const path = fileMatch[1].trim();
		// Stop at first non-attachment @ line so hand-typed multi-line text stays in body.
		if (!isUserMessageAttachmentPath(path)) break;
		files.push(path);
		remaining = fileMatch[2];
	}

	return { skillName, skillType, files, body: remaining };
}

/** Panel-selected files only (exclude image-cache / appshot system attachments). */
export function toMentionedFilesFromPrefixes(files: string[]): Array<{
	path: string;
	name: string;
	isDirectory: boolean;
}> {
	return files
		.filter((p) => !isSystemAttachmentPath(p))
		.map((p) => ({
			path: p,
			name: pathBasename(p),
			isDirectory: false,
		}));
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function base64SizeBytes(data: string): number {
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

export function extractToolImagePreview(result: unknown, details: unknown): ToolImagePreview | undefined {
	const resultRecord = asRecord(result);
	const content = Array.isArray(resultRecord?.content) ? resultRecord.content : Array.isArray(result) ? result : [];
	const image = content.find((part): part is { type: "image"; data: string; mimeType: string } => {
		const record = asRecord(part);
		return record?.type === "image" && typeof record.data === "string" && typeof record.mimeType === "string";
	});
	if (!image) return undefined;

	const detailsRecord = asRecord(details) ?? asRecord(resultRecord?.details);
	const imageDetails = asRecord(detailsRecord?.image);

	return {
		data: image.data,
		mimeType: image.mimeType,
		originalPath: typeof imageDetails?.originalPath === "string" ? imageDetails.originalPath : undefined,
		originalMimeType: typeof imageDetails?.originalMimeType === "string" ? imageDetails.originalMimeType : undefined,
		originalSizeBytes: asFiniteNumber(imageDetails?.originalSizeBytes),
		originalWidth: asFiniteNumber(imageDetails?.originalWidth),
		originalHeight: asFiniteNumber(imageDetails?.originalHeight),
		processedSizeBytes: asFiniteNumber(imageDetails?.processedSizeBytes) ?? base64SizeBytes(image.data),
		processedWidth: asFiniteNumber(imageDetails?.processedWidth),
		processedHeight: asFiniteNumber(imageDetails?.processedHeight),
		wasResized: typeof imageDetails?.wasResized === "boolean" ? imageDetails.wasResized : undefined,
	};
}

export function extractToolUiDetails(result: unknown, details: unknown): ToolCallUiDetails | undefined {
	const resultRecord = asRecord(result);
	const detailsRecord = asRecord(details) ?? asRecord(resultRecord?.details);
	if (!detailsRecord) return undefined;

	const diff = typeof detailsRecord.diff === "string" ? detailsRecord.diff : undefined;
	const firstChangedLine = asFiniteNumber(detailsRecord.firstChangedLine);
	const askUserQuestion = extractAskUserQuestion(detailsRecord);
	const knowledge = extractKnowledge(detailsRecord);
	if (diff === undefined && firstChangedLine === undefined && askUserQuestion === undefined && knowledge === undefined)
		return undefined;

	return {
		...(diff !== undefined ? { diff } : {}),
		...(firstChangedLine !== undefined ? { firstChangedLine } : {}),
		...(askUserQuestion !== undefined ? { askUserQuestion } : {}),
		...(knowledge !== undefined ? { knowledge } : {}),
	};
}

/** 从知识库工具的 details 里识别结构（按字段形状判别工具种类）。 */
function extractKnowledge(details: Record<string, unknown>): KnowledgeToolUiDetails | undefined {
	if (Array.isArray(details.pages)) {
		const pages = details.pages
			.map((p) => asRecord(p))
			.filter((p): p is Record<string, unknown> => p !== undefined)
			.map((p) => ({
				id: typeof p.id === "string" ? p.id : "",
				absolutePath: typeof p.absolutePath === "string" ? p.absolutePath : "",
				title: typeof p.title === "string" ? p.title : "",
				summary: typeof p.summary === "string" ? p.summary : "",
				tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === "string") : [],
			}));
		const count = asFiniteNumber(details.count) ?? pages.length;
		return { kind: "filter", count, pages };
	}
	if (Array.isArray(details.tags)) {
		const tags = details.tags
			.map((t) => asRecord(t))
			.filter((t): t is Record<string, unknown> => t !== undefined)
			.map((t) => ({
				tag: typeof t.tag === "string" ? t.tag : "",
				count: asFiniteNumber(t.count) ?? 0,
			}));
		return { kind: "tags", tags };
	}
	if (typeof details.action === "string" && typeof details.id === "string") {
		return {
			kind: "write",
			action: details.action,
			id: details.id,
			absolutePath: typeof details.absolutePath === "string" ? details.absolutePath : "",
			...(typeof details.movedFrom === "string" ? { movedFrom: details.movedFrom } : {}),
		};
	}
	return undefined;
}

/**
 * Parse card descriptors a tool emitted on its out-of-band `details.cards`.
 * Each is `{ type, key?, payload?, title?, icon? }`; `type` selects a plugin
 * card renderer host-side. Model-invisible — `details` never reaches the LLM.
 */
export function extractToolCards(result: unknown, details: unknown): CardDescriptor[] | undefined {
	const resultRecord = asRecord(result);
	const detailsRecord = asRecord(details) ?? asRecord(resultRecord?.details);
	const raw = detailsRecord?.cards;
	if (!Array.isArray(raw)) return undefined;
	const cards: CardDescriptor[] = [];
	for (const entry of raw) {
		const record = asRecord(entry);
		if (!record || typeof record.type !== "string" || record.type.length === 0) continue;
		cards.push({
			type: record.type,
			...(typeof record.key === "string" ? { key: record.key } : {}),
			...("payload" in record ? { payload: record.payload } : {}),
			...(typeof record.title === "string" ? { title: record.title } : {}),
			...(typeof record.icon === "string" ? { icon: record.icon } : {}),
		});
	}
	return cards.length > 0 ? cards : undefined;
}

/** ask_user_question 的 details（{cancelled, answers}）→ transcript 富视图用的 resolution。 */
function extractAskUserQuestion(detailsRecord: Record<string, unknown>): AskUserQuestionResolution | undefined {
	if (typeof detailsRecord.cancelled !== "boolean" || !Array.isArray(detailsRecord.answers)) return undefined;
	const answers = (detailsRecord.answers as Array<Record<string, unknown>>)
		.filter((a) => a && typeof a.question === "string" && Array.isArray(a.answers))
		.map((a) => ({
			question: a.question as string,
			answers: (a.answers as unknown[]).filter((x): x is string => typeof x === "string"),
		}));
	return { cancelled: detailsRecord.cancelled, answers };
}

/**
 * Convert a stored assistant message's content array into ContentBlock[].
 * Used for history loading only — tool_call blocks get status "success"
 * because history messages are already complete.
 */
export function messageToBlocks(content: unknown): ContentBlock[] {
	if (typeof content === "string") {
		return content ? [{ type: "text", id: nextId("blk"), text: content }] : [];
	}
	if (!Array.isArray(content)) return [];
	const blocks: ContentBlock[] = [];
	for (const part of content as Array<Record<string, unknown>>) {
		if (part.type === "text" && typeof part.text === "string") {
			blocks.push({ type: "text", id: nextId("blk"), text: part.text });
		} else if (part.type === "thinking" && typeof part.thinking === "string") {
			blocks.push({ type: "thinking", id: nextId("blk"), text: part.thinking });
		} else if (part.type === "toolCall" && typeof part.name === "string" && part.name !== "") {
			// Skip empty-name toolCall parts left behind by old provider parser bugs
			// (OpenAI-compat placeholder frames produced ghost {id:"", name:""} blocks
			// in some sessions). Showing them as unnamed tool blocks is meaningless
			// and confuses users.
			blocks.push({
				type: "tool_call",
				toolCallId: String(part.id ?? ""),
				toolName: String(part.name),
				args: (part.arguments as Record<string, unknown>) ?? {},
				status: "success",
			});
		}
	}
	return blocks;
}

/**
 * Convert history messages (user, assistant, toolResult) into ChatMessages.
 * Tool results are merged into their corresponding tool_call blocks.
 */
export function historyToChat(
	history: Array<{
		role: string;
		content: unknown;
		toolCallId?: string;
		toolName?: string;
		isError?: boolean;
		errorMessage?: string;
		stopReason?: string;
		details?: unknown;
	}>,
): ChatMessage[] {
	const messages: ChatMessage[] = [];
	const toolCallIndex = new Map<string, ToolCallBlock>();

	/** Get or create the current assistant message to accumulate blocks into. */
	function currentAssistant(): ChatMessage {
		const last = messages.at(-1);
		if (last?.role === "assistant") return last;
		const msg: ChatMessage = {
			id: `hist-asst-${messages.length}`,
			role: "assistant",
			text: "",
			blocks: [],
		};
		messages.push(msg);
		return msg;
	}

	for (const m of history) {
		if (m.role === "user") {
			const text = extractText(m.content);
			const parsedUser = parseUserPrefixes(text);
			const legacyPromptRef: PromptResourceRef | undefined =
				parsedUser.skillName && parsedUser.skillType
					? { kind: parsedUser.skillType, name: parsedUser.skillName }
					: undefined;
			const userMsg: ChatMessage = {
				id: `hist-user-${messages.length}`,
				role: "user",
				text,
				promptRef: legacyPromptRef,
				// Only absolute (panel/system) prefixes; hand-typed @text stays in body.
				// Exclude image-cache so system images/appshot don't become file badges.
				mentionedFiles: toMentionedFilesFromPrefixes(parsedUser.files),
			};
			messages.push(userMsg);
		} else if (m.role === "assistant") {
			// Merge consecutive assistant messages into one (same agent turn)
			const target = currentAssistant();
			const blocks = messageToBlocks(m.content);
			for (const b of blocks) {
				if (b.type === "tool_call") toolCallIndex.set(b.toolCallId, b);
			}
			target.blocks!.push(...blocks);
			// Accumulate text
			const text = extractText(m.content);
			if (text) target.text = target.text ? `${target.text}\n${text}` : text;
			// Handle error messages (e.g. provider 404)
			if (m.stopReason === "error" && m.errorMessage) {
				target.blocks!.push({ type: "error", id: nextId("blk"), text: m.errorMessage });
				if (!target.text) target.text = m.errorMessage;
			}
		} else if (m.role === "toolResult" && m.toolCallId) {
			const block = toolCallIndex.get(String(m.toolCallId));
			if (block) {
				block.result = extractText(m.content);
				block.imagePreview = extractToolImagePreview(m.content, m.details);
				block.uiDetails = extractToolUiDetails(m.content, m.details);
				block.cards = extractToolCards(m.content, m.details);
				block.isError = m.isError === true;
				block.status = m.isError ? "error" : "success";
			}
		}
	}
	return messages;
}

/**
 * Convert full history entries (including compaction boundaries) into ChatMessages.
 * Unlike historyToChat, this preserves the complete conversation across compactions.
 */
export function fullHistoryToChat(entries: HistoryEntry[]): ChatMessage[] {
	const messages: ChatMessage[] = [];
	const toolCallIndex = new Map<string, ToolCallBlock>();

	function currentAssistant(): ChatMessage {
		const last = messages.at(-1);
		if (last?.role === "assistant") return last;
		const msg: ChatMessage = {
			id: `hist-asst-${messages.length}`,
			role: "assistant",
			text: "",
			blocks: [],
		};
		messages.push(msg);
		return msg;
	}

	/** Next user message follows a settings-assist model-only instruction. */
	let pendingSettingsAssistTabId: string | undefined;
	/** Next user message follows a Skill / Scene expansion marker. */
	let pendingPromptRef: PromptResourceRef | undefined;
	/** Next user message carries structured filesystem attachments. */
	let pendingAttachments: PromptAttachmentRef[] | undefined;

	for (const entry of entries) {
		if (entry.type === "compaction") {
			pendingSettingsAssistTabId = undefined;
			pendingPromptRef = undefined;
			pendingAttachments = undefined;
			messages.push({
				id: entry.entryId ?? `hist-compact-${messages.length}`,
				entryId: entry.entryId,
				role: "compaction",
				text: entry.summary,
				timestamp: new Date(entry.timestamp).getTime(),
			});
			continue;
		}

		if (entry.type === "settings_assist_marker") {
			pendingSettingsAssistTabId = entry.tabId?.trim() || "unknown";
			continue;
		}

		if (entry.type === "prompt_ref_marker") {
			pendingPromptRef = entry.promptRef;
			continue;
		}

		if (entry.type === "prompt_attachments_marker") {
			pendingAttachments = entry.attachments;
			continue;
		}

		if (entry.type === "assistant_turn_timing") {
			const { startedAt, endedAt, durationMs } = entry.timing;
			let patchedAssistant = false;
			for (let i = messages.length - 1; i >= 0; i--) {
				const message = messages[i];
				if (!patchedAssistant && message.role === "assistant") {
					messages[i] = {
						...message,
						startedAt,
						endedAt,
						durationSeconds: durationMs / 1000,
					};
					patchedAssistant = true;
					continue;
				}
				// 用户消息无独立持久化时间戳，用本轮开始时间近似其发送时刻。
				if (message.role === "user" && message.timestamp === undefined) {
					messages[i] = { ...message, timestamp: startedAt };
					break;
				}
			}
			continue;
		}

		if (entry.type === "tool_timing") {
			// Attach out-of-band timing to its matching tool_call block. UI-only;
			// never round-trips into LLM context (see ADR 0001).
			const block = toolCallIndex.get(entry.toolCallId);
			if (block) {
				block.startedAt = entry.startedAt;
				block.durationMs = entry.durationMs;
				block.phases = entry.phases.map((p) => ({ label: p.label, atMs: p.atMs }));
			}
			continue;
		}

		const m = entry.message as {
			role: string;
			content: unknown;
			toolCallId?: string;
			toolName?: string;
			isError?: boolean;
			errorMessage?: string;
			stopReason?: string;
			details?: unknown;
			provider?: string;
			model?: string;
		};

		if (m.role === "user") {
			const text = extractText(m.content);
			const parsedUser = parseUserPrefixes(text);
			const legacyPromptRef: PromptResourceRef | undefined =
				parsedUser.skillName && parsedUser.skillType
					? { kind: parsedUser.skillType, name: parsedUser.skillName }
					: undefined;
			const entryId = entry.type === "message" ? entry.entryId : undefined;
			const parentId = entry.type === "message" ? entry.parentId : undefined;
			const branch = entry.type === "message" ? entry.branch : undefined;
			const userMsg: ChatMessage = {
				id: entryId ?? `hist-user-${messages.length}`,
				entryId,
				parentId,
				branch: branch ? { siblings: branch.siblings, index: branch.index } : undefined,
				role: "user",
				text,
				promptRef: pendingPromptRef ?? legacyPromptRef,
				attachments: pendingAttachments,
				// Only absolute (panel/system) prefixes; hand-typed @text stays in body.
				// Exclude image-cache so system images/appshot don't become file badges.
				mentionedFiles: toMentionedFilesFromPrefixes(parsedUser.files),
			};
			if (pendingSettingsAssistTabId) {
				userMsg.settingsAssistTabId = pendingSettingsAssistTabId;
				pendingSettingsAssistTabId = undefined;
			}
			pendingPromptRef = undefined;
			pendingAttachments = undefined;
			messages.push(userMsg);
		} else if (m.role === "assistant") {
			pendingSettingsAssistTabId = undefined;
			pendingPromptRef = undefined;
			pendingAttachments = undefined;
			const entryId = entry.type === "message" ? entry.entryId : undefined;
			const target = currentAssistant();
			// Prefer first assistant entry id for the merged bubble when not set yet.
			if (entryId && !target.entryId) {
				target.entryId = entryId;
				target.id = entryId;
			}
			const blocks = messageToBlocks(m.content);
			for (const b of blocks) {
				if (b.type === "tool_call") toolCallIndex.set(b.toolCallId, b);
			}
			target.blocks!.push(...blocks);
			const text = extractText(m.content);
			if (text) target.text = target.text ? `${target.text}\n${text}` : text;
			if (m.stopReason === "error" && m.errorMessage) {
				target.blocks!.push({ type: "error", id: nextId("blk"), text: m.errorMessage });
				if (!target.text) target.text = m.errorMessage;
			}
			// 回填本轮 user 消息实际使用的模型：从末尾向前找到第一条尚未标注 model 的 user 消息。
			if (m.provider && m.model) {
				for (let i = messages.length - 1; i >= 0; i--) {
					const message = messages[i];
					if (message.role === "user" && message.model === undefined) {
						messages[i] = { ...message, model: { provider: m.provider, id: m.model } };
						break;
					}
				}
			}
		} else if (m.role === "toolResult" && m.toolCallId) {
			const block = toolCallIndex.get(String(m.toolCallId));
			if (block) {
				block.result = extractText(m.content);
				block.imagePreview = extractToolImagePreview(m.content, m.details);
				block.uiDetails = extractToolUiDetails(m.content, m.details);
				block.cards = extractToolCards(m.content, m.details);
				block.isError = m.isError === true;
				block.status = m.isError ? "error" : "success";
			}
		}
	}
	return messages;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Streaming state — module-level to survive React StrictMode double-invoke
// ═══════════════════════════════════════════════════════════════════════════════

export let currentUnsubscribe: (() => void) | null = null;
export function setCurrentUnsubscribe(fn: (() => void) | null): void {
	currentUnsubscribe = fn;
}

// 调用令牌：openSession 是一段串行 await，期间用户可能再次切换 session，
// 第二个 openSession 会在第一个尚未把 unsub 写入 currentUnsubscribe 时就完成
// 自己的 teardown（teardown 时 currentUnsubscribe 还是 null，什么都拆不掉），
// 然后两个 subscribe 都成功 → 后者覆盖前者，前者的 IPC 监听器永远泄漏。
// 每次进入 openSession 调用 bumpOpenSessionToken() 拿到自己的 token，在 await
// 完 subscribe() 后再校验一次 token，发现被超越就立刻 unsub 自己创建的订阅。
let openSessionToken = 0;
export function bumpOpenSessionToken(): number {
	return ++openSessionToken;
}
export function getOpenSessionToken(): number {
	return openSessionToken;
}

/**
 * ID of the current "draft" assistant message being streamed.
 * - Set when the first delta (text or thinking) of a turn arrives.
 * - Cleared when message.final finalizes the message.
 */
let draftId: string | null = null;

/** Monotonically increasing counter for unique message IDs. */
let idCounter = 0;
export function nextId(prefix: string): string {
	return `${prefix}-${++idCounter}-${Date.now()}`;
}

/** Timestamp (ms) when the current agent turn started. */
export let turnStartTime = 0;
export function setTurnStartTime(t: number): void {
	turnStartTime = t;
}

/** Per-session cache for turn stats (survives session switching). Key = sessionPath. */
export const turnStatsCache = new Map<string, { outputSpeed: number; durationSeconds: number }>();

/** Reset streaming state (when switching sessions). */
export function resetStreamState(): void {
	draftId = null;
}

/** Adopt an existing history message as the current draft (for session restore while streaming). */
export function adoptDraftId(id: string): void {
	draftId = id;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Immutable state update helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ensure a draft assistant message exists for the current turn.
 * Returns [newMessages, draftIndex]. Creates a new draft if needed.
 */
export function ensureDraft(prev: ChatMessage[]): [ChatMessage[], number] {
	if (draftId) {
		// Find existing draft
		for (let i = prev.length - 1; i >= 0; i--) {
			if (prev[i].id === draftId) {
				return [[...prev], i];
			}
		}
		// Draft ID is stale — fall through to create new
	}

	// Create new draft
	const id = nextId("draft");
	draftId = id;
	const draftTimestamp = turnStartTime || Date.now();
	const draft: ChatMessage = {
		id,
		role: "assistant",
		text: "",
		blocks: [],
		timestamp: draftTimestamp,
		startedAt: draftTimestamp,
	};
	const copy = [...prev, draft];
	return [copy, copy.length - 1];
}

/**
 * Append a text delta to a draft message's last text block (or create one).
 */
export function appendTextDelta(prev: ChatMessage[], delta: string): ChatMessage[] {
	const [msgs, idx] = ensureDraft(prev);
	const msg = msgs[idx];
	const blocks = [...(msg.blocks ?? [])];
	const last = blocks.at(-1);

	if (last?.type === "text") {
		blocks[blocks.length - 1] = { ...last, text: last.text + delta };
	} else {
		blocks.push({ type: "text", id: nextId("blk"), text: delta });
	}

	msgs[idx] = { ...msg, text: msg.text + delta, blocks };
	return msgs;
}

/**
 * Append a thinking delta to a draft message's last thinking block (or create one).
 */
export function appendThinkingDelta(prev: ChatMessage[], delta: string): ChatMessage[] {
	const [msgs, idx] = ensureDraft(prev);
	const msg = msgs[idx];
	const blocks = [...(msg.blocks ?? [])];
	const last = blocks.at(-1);

	if (last?.type === "thinking") {
		blocks[blocks.length - 1] = { ...last, text: last.text + delta };
	} else {
		blocks.push({ type: "thinking", id: nextId("blk"), text: delta });
	}

	msgs[idx] = { ...msg, blocks };
	return msgs;
}

/**
 * Finalize the current draft with the complete message content.
 *
 * An agent turn can produce multiple message.final events (one per LLM call
 * in the agent loop). All content accumulates into a single assistant message.
 *
 * Strategy:
 * - Keep ALL existing blocks on the message (from previous LLM calls in this turn).
 * - The current LLM call's content was already streamed via deltas, so the
 *   blocks are already present. We use the final message to ensure tool_call
 *   blocks exist with correct args.
 * - draftId is NOT cleared here — it persists until resetStreamState() at agent_end.
 */
export function finalizeMessage(prev: ChatMessage[], content: unknown): ChatMessage[] {
	const copy = [...prev];

	// Parse tool calls from the final message
	const finalToolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
	if (Array.isArray(content)) {
		for (const part of content as Array<Record<string, unknown>>) {
			if (part.type === "toolCall" && typeof part.name === "string") {
				finalToolCalls.push({
					id: String(part.id ?? ""),
					name: String(part.name),
					args: (part.arguments as Record<string, unknown>) ?? {},
				});
			}
		}
	}

	// Find the target message (draft or last assistant)
	let targetIdx = -1;
	if (draftId) {
		for (let i = copy.length - 1; i >= 0; i--) {
			if (copy[i].id === draftId) {
				targetIdx = i;
				break;
			}
		}
	}
	if (targetIdx === -1) {
		// No draft — find last assistant message or create one
		for (let i = copy.length - 1; i >= 0; i--) {
			if (copy[i].role === "assistant") {
				targetIdx = i;
				break;
			}
		}
		if (targetIdx === -1) {
			const id = nextId("final");
			draftId = id;
			const draftTimestamp = turnStartTime || Date.now();
			copy.push({
				id,
				role: "assistant",
				text: "",
				blocks: [],
				timestamp: draftTimestamp,
				startedAt: draftTimestamp,
			});
			targetIdx = copy.length - 1;
		}
	}

	const msg = copy[targetIdx];
	const blocks = [...(msg.blocks ?? [])];

	// Collect existing tool_call IDs
	const existingToolIds = new Set<string>();
	for (const b of blocks) {
		if (b.type === "tool_call") existingToolIds.add(b.toolCallId);
	}

	// Merge tool calls: update existing or add new
	for (const tc of finalToolCalls) {
		if (existingToolIds.has(tc.id)) {
			const idx = blocks.findIndex((b) => b.type === "tool_call" && b.toolCallId === tc.id);
			if (idx !== -1) {
				const existing = blocks[idx] as ToolCallBlock;
				if (Object.keys(existing.args).length === 0 && Object.keys(tc.args).length > 0) {
					blocks[idx] = { ...existing, args: tc.args };
				}
			}
		} else {
			blocks.push({
				type: "tool_call",
				toolCallId: tc.id,
				toolName: tc.name,
				args: tc.args,
				status: "pending",
			});
		}
	}

	// Update text from all text blocks
	const text = blocks
		.filter((b) => b.type === "text")
		.map((b) => (b as { text: string }).text)
		.join("");

	copy[targetIdx] = { ...msg, text, blocks };

	// Do NOT clear draftId — the agent turn may continue with more LLM calls.
	// draftId is cleared by resetStreamState() at agent_start/agent_end.
	return copy;
}

/**
 * Handle tool.start: find or create a tool_call block on the last assistant message.
 */
export function handleToolStart(
	prev: ChatMessage[],
	toolCallId: string,
	toolName: string,
	args: Record<string, unknown>,
	startedAt?: number,
): ChatMessage[] {
	// First: search for a finalized message from the current turn (not a draft)
	// or the current draft. We only want to attach to the LAST assistant message
	// that belongs to the current turn, not older history messages.
	const lastMsg = prev.length > 0 ? prev[prev.length - 1] : null;

	// If the last message is an assistant message, attach to it
	if (lastMsg?.role === "assistant") {
		const blocks = [...(lastMsg.blocks ?? [])];

		// Check if this tool_call block already exists (from toolcall.start or message.final)
		const existing = blocks.findIndex((b) => b.type === "tool_call" && b.toolCallId === toolCallId);
		if (existing !== -1) {
			const block = blocks[existing] as ToolCallBlock;
			const argsChanged = Object.keys(block.args).length === 0 && Object.keys(args).length > 0;
			const startedAtChanged = startedAt !== undefined && block.startedAt === undefined;
			if (argsChanged || startedAtChanged) {
				blocks[existing] = {
					...block,
					args: argsChanged ? args : block.args,
					startedAt: startedAtChanged ? startedAt : block.startedAt,
				};
				const copy = [...prev];
				copy[copy.length - 1] = { ...lastMsg, blocks };
				return copy;
			}
			return prev;
		}

		blocks.push({
			type: "tool_call",
			toolCallId,
			toolName,
			args,
			status: "pending",
			startedAt,
		});

		const copy = [...prev];
		copy[copy.length - 1] = { ...lastMsg, blocks };
		return copy;
	}

	// No recent assistant message — use ensureDraft to keep one turn = one message
	const [msgs, idx] = ensureDraft(prev);
	const msg = msgs[idx];
	const blocks = [...(msg.blocks ?? [])];
	blocks.push({
		type: "tool_call",
		toolCallId,
		toolName,
		args,
		status: "pending",
		startedAt,
	});
	msgs[idx] = { ...msg, blocks };
	return msgs;
}

/**
 * Handle tool.end: find the matching tool_call block and update it with the result.
 */
export function handleToolEnd(
	prev: ChatMessage[],
	toolCallId: string,
	result: unknown,
	isError: boolean,
	timing?: { startedAt: number; durationMs: number; phases: Array<{ label: string; atMs: number }> },
): ChatMessage[] {
	const resultText = extractResultText(result);
	const imagePreview = extractToolImagePreview(result, undefined);
	const uiDetails = extractToolUiDetails(result, undefined);
	const cards = extractToolCards(result, undefined);

	// Search backwards for the matching tool_call block
	for (let i = prev.length - 1; i >= 0; i--) {
		const msg = prev[i];
		if (msg.role !== "assistant" || !msg.blocks) continue;

		const blockIdx = msg.blocks.findIndex((b) => b.type === "tool_call" && b.toolCallId === toolCallId);
		if (blockIdx === -1) continue;

		const copy = [...prev];
		const blocks = [...msg.blocks];
		const block = blocks[blockIdx] as ToolCallBlock;
		blocks[blockIdx] = {
			...block,
			status: isError ? "error" : "success",
			result: resultText,
			imagePreview,
			uiDetails,
			cards,
			isError,
			startedAt: timing?.startedAt ?? block.startedAt,
			durationMs: timing?.durationMs ?? block.durationMs,
			phases: timing?.phases ?? block.phases,
			// Clear currentPhase — execution is over, the badge is no longer "live".
			currentPhase: undefined,
		};
		copy[i] = { ...msg, blocks };
		return copy;
	}

	return prev;
}

/**
 * Handle tool.phase: append a phase boundary to the matching tool_call block
 * while it's still streaming, and mark it as the live "currentPhase" for header
 * display. Both are out-of-band metadata — never sent to the LLM.
 */
export function handleToolPhase(prev: ChatMessage[], toolCallId: string, label: string, atMs: number): ChatMessage[] {
	for (let i = prev.length - 1; i >= 0; i--) {
		const msg = prev[i];
		if (msg.role !== "assistant" || !msg.blocks) continue;

		const blockIdx = msg.blocks.findIndex((b) => b.type === "tool_call" && b.toolCallId === toolCallId);
		if (blockIdx === -1) continue;

		const copy = [...prev];
		const blocks = [...msg.blocks];
		const block = blocks[blockIdx] as ToolCallBlock;
		blocks[blockIdx] = {
			...block,
			phases: [...(block.phases ?? []), { label, atMs }],
			currentPhase: label,
		};
		copy[i] = { ...msg, blocks };
		return copy;
	}

	return prev;
}

/**
 * Append an error block to the current draft assistant message.
 */
export function appendError(prev: ChatMessage[], errorMessage: string): ChatMessage[] {
	const [msgs, idx] = ensureDraft(prev);
	const msg = msgs[idx];
	const blocks = [...(msg.blocks ?? [])];
	blocks.push({ type: "error", id: nextId("blk"), text: errorMessage });
	msgs[idx] = { ...msg, text: msg.text || errorMessage, blocks };
	return msgs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Ref-based variants (for components that manage their own draft state)
// ═══════════════════════════════════════════════════════════════════════════════

function ensureDraftWithRef(prev: ChatMessage[], draftIdRef: { current: string | null }): [ChatMessage[], number] {
	if (draftIdRef.current) {
		for (let i = prev.length - 1; i >= 0; i--) {
			if (prev[i].id === draftIdRef.current) {
				return [[...prev], i];
			}
		}
	}
	const id = nextId("draft");
	draftIdRef.current = id;
	const draftTimestamp = turnStartTime || Date.now();
	const draft: ChatMessage = {
		id,
		role: "assistant",
		text: "",
		blocks: [],
		timestamp: draftTimestamp,
		startedAt: draftTimestamp,
	};
	const copy = [...prev, draft];
	return [copy, copy.length - 1];
}

export function clearDraftMessage(prev: ChatMessage[], draftIdRef: { current: string | null }): ChatMessage[] {
	const did = draftIdRef.current;
	if (!did) return prev;
	const idx = prev.findIndex((m) => m.id === did);
	if (idx === -1) return prev;
	const copy = [...prev];
	copy.splice(idx, 1);
	draftIdRef.current = null;
	return copy;
}

export function appendTextDeltaWithRef(
	prev: ChatMessage[],
	delta: string,
	draftIdRef: { current: string | null },
): ChatMessage[] {
	const [msgs, idx] = ensureDraftWithRef(prev, draftIdRef);
	const msg = msgs[idx];
	const blocks = [...(msg.blocks ?? [])];
	const last = blocks.at(-1);
	if (last?.type === "text") {
		blocks[blocks.length - 1] = { ...last, text: last.text + delta };
	} else {
		blocks.push({ type: "text", id: nextId("blk"), text: delta });
	}
	msgs[idx] = { ...msg, text: msg.text + delta, blocks };
	return msgs;
}

export function appendThinkingDeltaWithRef(
	prev: ChatMessage[],
	delta: string,
	draftIdRef: { current: string | null },
): ChatMessage[] {
	const [msgs, idx] = ensureDraftWithRef(prev, draftIdRef);
	const msg = msgs[idx];
	const blocks = [...(msg.blocks ?? [])];
	const last = blocks.at(-1);
	if (last?.type === "thinking") {
		blocks[blocks.length - 1] = { ...last, text: last.text + delta };
	} else {
		blocks.push({ type: "thinking", id: nextId("blk"), text: delta });
	}
	msgs[idx] = { ...msg, blocks };
	return msgs;
}
