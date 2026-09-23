import { basename } from "node:path";
import type { Message } from "@vetta/ai";
import type {
	CodingAgentQuestionFunctionRequest,
	CodingAgentQuestionResult,
} from "@vetta/coding-agent/function-extensions";
import type { RemoteQuestionRequest, RemoteToolCallSummary, RemoteTranscriptEntry } from "@vetta/remote-control";
import { sha256Hex } from "@vetta/remote-control";
import type { HistoryEntry } from "@vetta/runtime-core";
import { RemoteOperationError } from "./remote-error-mapping.js";

const MAX_HISTORY_ENTRIES = 240;
const PREVIEW_CHARS = 1_200;

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
	return entries.length > MAX_HISTORY_ENTRIES ? entries.slice(entries.length - MAX_HISTORY_ENTRIES) : entries;
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
