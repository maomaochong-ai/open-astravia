import { basename } from "node:path";
import type { Message } from "@vetta/ai";
import type {
	CodingAgentQuestionFunctionRequest,
	CodingAgentQuestionResult,
} from "@vetta/coding-agent/function-extensions";
import type {
	RemoteQuestionRequest,
	RemoteToolCallSummary,
	RemoteToolResult,
	RemoteTranscriptEntry,
} from "@vetta/remote-control";
import { REMOTE_MAX_TOOL_RESULT_CHARS, sha256Hex } from "@vetta/remote-control";
import type { HistoryEntry } from "@vetta/runtime-core";
import { RemoteOperationError } from "./remote-error-mapping.js";

const PREVIEW_CHARS = 1_200;
/** A phone that asks for no page size, as phones did before paging, gets this many of the newest entries. */
const LEGACY_PAGE_ENTRIES = 240;
const MAX_PAGE_ENTRIES = 120;
/**
 * A page's entries in UTF-8 bytes. Sealed and base64-encoded it stays well under the
 * relay's and the P2P channel's 1.5 MB per frame; a long chat sent whole went over and
 * was dropped, so the phone waited out the request and showed the history as failed.
 */
const PAGE_BUDGET_BYTES = 400 * 1024;
/** What one entry's reply and thinking keep when that entry alone is past the budget. */
const OVERSIZED_TEXT_CHARS = 100_000;
const OVERSIZED_THINKING_CHARS = 20_000;

export interface TranscriptPage {
	readonly entries: RemoteTranscriptEntry[];
	/** Older entries exist before the page; the phone asks for them with `before`. */
	readonly hasMore: boolean;
}

/** Pure conversions between runtime history/questions and the phone-facing contract. */

export function keyForPath(path: string): string {
	return sha256Hex(path).slice(0, 24);
}

export function toTranscript(history: readonly HistoryEntry[]): RemoteTranscriptEntry[] {
	const entries: RemoteTranscriptEntry[] = [];
	let counter = 0;
	const nextId = (prefix: string): string => `${prefix}-${++counter}`;
	for (const entry of history) {
		if (entry.type === "compaction") {
			entries.push({ kind: "marker", id: nextId("m"), text: "context compacted", at: epochMs(entry.timestamp) });
			continue;
		}
		if (entry.type === "error") {
			// A failure belongs to the turn it ended, like on the desktop: attach it to that
			// turn's reply instead of a marker, which would split the turn on the phone.
			const last = entries[entries.length - 1];
			if (last?.kind === "assistant" && (!last.error || last.error === entry.message)) {
				entries[entries.length - 1] = { ...last, error: entry.message };
			} else {
				entries.push({
					kind: "assistant",
					id: entry.entryId ?? nextId("e"),
					text: "",
					toolCalls: [],
					at: epochMs(entry.timestamp),
					error: entry.message,
				});
			}
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "user") {
			entries.push({
				kind: "user",
				id: entry.entryId ?? nextId("u"),
				text: textOf(message.content),
				at: message.timestamp,
			});
			continue;
		}
		if (message.role === "assistant") {
			const toolCalls: RemoteToolCallSummary[] = [];
			let text = "";
			let thinking = "";
			for (const part of message.content) {
				if (part.type === "text") text += part.text;
				else if (part.type === "thinking") thinking += part.thinking;
				else if (part.type === "toolCall")
					toolCalls.push({ toolCallId: part.id, toolName: part.name, args: preview(part.arguments) });
			}
			entries.push({
				kind: "assistant",
				id: entry.entryId ?? nextId("a"),
				text,
				thinking: thinking || undefined,
				toolCalls,
				at: message.timestamp,
				error: message.errorMessage,
			});
			continue;
		}
		if (message.role === "toolResult") {
			for (let index = entries.length - 1; index >= 0; index -= 1) {
				const candidate = entries[index];
				if (candidate?.kind !== "assistant") continue;
				const call = candidate.toolCalls.find((item) => item.toolCallId === message.toolCallId);
				if (!call) continue;
				const updated: RemoteToolCallSummary = {
					...call,
					result: preview(textOf(message.content)),
					isError: message.isError,
				};
				entries[index] = {
					...candidate,
					toolCalls: candidate.toolCalls.map((item) => (item === call ? updated : item)),
				};
				break;
			}
		}
	}
	return entries;
}

/**
 * The newest entries before `before` (the whole transcript's end when absent), at most
 * `limit` and within a frame's budget. A page starts at a user message when that costs at
 * most half of it, so a turn split across two pages does not show up as two turns until
 * the older page comes; a longer turn is split, and joins up once its start arrives.
 * An unknown `before` is an empty page: the transcript it came from is gone.
 */
export function pageTranscript(
	entries: readonly RemoteTranscriptEntry[],
	request: { readonly limit?: unknown; readonly before?: unknown },
): TranscriptPage {
	const paged = typeof request.limit === "number" && Number.isFinite(request.limit);
	const limit = paged
		? Math.max(1, Math.min(MAX_PAGE_ENTRIES, Math.floor(request.limit as number)))
		: LEGACY_PAGE_ENTRIES;
	let end = entries.length;
	if (typeof request.before === "string") {
		end = entries.findIndex((entry) => entry.id === request.before);
		if (end < 0) return { entries: [], hasMore: false };
	}
	const page: RemoteTranscriptEntry[] = [];
	let bytes = 0;
	let start = end;
	while (start > 0 && page.length < limit) {
		const entry = fitEntry(entries[start - 1] as RemoteTranscriptEntry);
		const size = Buffer.byteLength(JSON.stringify(entry));
		if (page.length > 0 && bytes + size > PAGE_BUDGET_BYTES) break;
		page.unshift(entry);
		bytes += size;
		start -= 1;
	}
	if (start > 0 && page[0]?.kind !== "user") {
		const firstUser = page.findIndex((entry) => entry.kind === "user");
		// A turn longer than half a page stays split: cut, the page would hold little else.
		if (firstUser > 0 && firstUser <= page.length / 2) {
			page.splice(0, firstUser);
			start += firstUser;
		}
	}
	return { entries: page, hasMore: start > 0 };
}

/** Cuts the reply and thinking of an entry too big for any page on its own. */
function fitEntry(entry: RemoteTranscriptEntry): RemoteTranscriptEntry {
	if (entry.kind !== "assistant" || Buffer.byteLength(JSON.stringify(entry)) <= PAGE_BUDGET_BYTES) return entry;
	const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
	return {
		...entry,
		text: clip(entry.text, OVERSIZED_TEXT_CHARS),
		thinking: entry.thinking === undefined ? undefined : clip(entry.thinking, OVERSIZED_THINKING_CHARS),
	};
}

export function toRemoteQuestion(request: CodingAgentQuestionFunctionRequest): RemoteQuestionRequest {
	return {
		requestId: request.requestId,
		questions: request.questions.map((item) => ({
			question: item.question,
			header: item.header,
			options: item.options.map((option) => ({ label: option.label, description: option.description })),
			multiSelect: item.multiSelect === true,
		})),
	};
}

export function readQuestionResult(payload: Record<string, unknown>): CodingAgentQuestionResult {
	if (typeof payload.cancelled !== "boolean" || !Array.isArray(payload.answers)) {
		throw new RemoteOperationError("invalid_frame", "question response is invalid");
	}
	const answers = payload.answers
		.filter((answer): answer is Record<string, unknown> => typeof answer === "object" && answer !== null)
		.map((answer) => ({
			question: typeof answer.question === "string" ? answer.question : "",
			answers: Array.isArray(answer.answers)
				? answer.answers.filter((value): value is string => typeof value === "string")
				: [],
		}))
		.filter((answer) => answer.question.length > 0);
	return { cancelled: payload.cancelled, answers };
}

/**
 * A tool call's whole result for `tool.result`, where history and events carry a preview.
 * The newest result wins should a call id ever repeat.
 */
export function findToolResult(history: readonly HistoryEntry[], toolCallId: string): RemoteToolResult {
	for (let index = history.length - 1; index >= 0; index -= 1) {
		const entry = history[index];
		if (entry?.type !== "message" || entry.message.role !== "toolResult") continue;
		const message = entry.message;
		if (message.toolCallId !== toolCallId) continue;
		const result = textOf(message.content);
		if (result.length > REMOTE_MAX_TOOL_RESULT_CHARS) {
			throw new RemoteOperationError("too_large", "Tool result is too large to send");
		}
		return { toolCallId, toolName: message.toolName, result, isError: message.isError };
	}
	throw new RemoteOperationError("not_found", "Tool result was not found");
}

export function textOf(content: Message["content"]): string {
	if (typeof content === "string") return content;
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("");
}

export function lastUserTimestamp(messages: readonly Message[]): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "user") return message.timestamp;
	}
	return 0;
}

/** Timestamp of the user message before the latest one, so the latest can still be announced. */
export function previousUserTimestamp(messages: readonly Message[]): number {
	let seenLatest = false;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "user") continue;
		if (!seenLatest) {
			seenLatest = true;
			continue;
		}
		return message.timestamp;
	}
	return 0;
}

export function modelLabel(model: unknown): string | undefined {
	if (typeof model !== "object" || model === null) return undefined;
	const record = model as Record<string, unknown>;
	if (typeof record.name === "string" && record.name) return record.name;
	if (typeof record.id === "string" && record.id) return record.id;
	return undefined;
}

export function preview(value: unknown): string {
	let text: string;
	try {
		text = typeof value === "string" ? value : JSON.stringify(value);
	} catch {
		text = String(value);
	}
	if (typeof text !== "string") return "";
	return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

export function safeErrorMessage(error: unknown): string {
	if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
		return error.message.slice(0, 200);
	}
	return "Desktop turn failed";
}

export function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function epochMs(value: unknown): number | undefined {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? undefined : parsed;
	}
	return undefined;
}

export function projectDisplayName(cwd: string, name?: string): string {
	return name?.trim() || basename(cwd) || cwd;
}
