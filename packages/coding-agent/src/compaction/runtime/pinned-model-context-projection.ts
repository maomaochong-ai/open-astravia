import type { Message, UserMessage } from "@vetta/ai";
import type { SessionContextRecord } from "@vetta/runtime-core/kernel";
import type { CodingAgentPinnedModelContext } from "../../runtime-contracts/index.js";

/** Validates the host boundary before a pinned prefix can affect model input. */
export function requireCodingAgentPinnedModelContext(value: unknown): CodingAgentPinnedModelContext | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value) || typeof value.id !== "string" || value.id.trim().length === 0) {
		throw new Error("Coding Agent pinned model context requires a non-empty id");
	}
	if (!Array.isArray(value.records) || !value.records.every(isPinnedRecord)) {
		throw new Error("Coding Agent pinned model context contains an invalid record");
	}
	if (
		value.conversationProjections !== undefined &&
		(!Array.isArray(value.conversationProjections) ||
			!value.conversationProjections.every(
				(projection) =>
					isRecord(projection) &&
					typeof projection.entryId === "string" &&
					projection.entryId.length > 0 &&
					(projection.kind === "omit-entry" || projection.kind === "omit-assistant-text"),
			) ||
			new Set(value.conversationProjections.map((projection) => projection.entryId)).size !==
				value.conversationProjections.length)
	) {
		throw new Error("Coding Agent pinned model context contains an invalid or duplicate conversation projection");
	}
	return {
		id: value.id,
		records: freezeContextValue(structuredClone(value.records)),
		...(value.conversationProjections
			? { conversationProjections: freezeContextValue(structuredClone(value.conversationProjections)) }
			: {}),
	};
}

/** Places the shared prefix before private history; duplicates are excluded by persistent entry identity. */
export function applyPinnedModelContext(
	messages: readonly Message[],
	context: CodingAgentPinnedModelContext | undefined,
): Message[] {
	if (!context || context.records.length === 0) return [...messages];
	return [...context.records.map(toUserMessage), ...messages];
}

function toUserMessage(record: SessionContextRecord): UserMessage {
	return { role: "user", content: record.content, timestamp: record.timestamp! };
}

function freezeContextValue<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const nested of Object.values(value)) freezeContextValue(nested);
		Object.freeze(value);
	}
	return value;
}

function isPinnedRecord(value: unknown): value is SessionContextRecord {
	return (
		isRecord(value) &&
		typeof value.type === "string" &&
		value.type.length > 0 &&
		value.modelVisible === true &&
		isUserContent(value.content) &&
		typeof value.timestamp === "number" &&
		Number.isFinite(value.timestamp)
	);
}

function isUserContent(value: unknown): value is UserMessage["content"] {
	if (typeof value === "string") return true;
	if (!Array.isArray(value)) return false;
	return value.every(
		(item) =>
			isRecord(item) &&
			((item.type === "text" && typeof item.text === "string") ||
				(item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string")),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
