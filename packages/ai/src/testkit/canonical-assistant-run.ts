import type { AssistantMessage, AssistantMessageEvent, ToolCall } from "../types.js";

export type CanonicalToolCall = Omit<ToolCall, "arguments"> & {
	readonly arguments: Record<string, unknown>;
};

export type CanonicalAssistantContent = Exclude<AssistantMessage["content"][number], ToolCall> | CanonicalToolCall;

export type CanonicalAssistantMessage = Omit<AssistantMessage, "content" | "timestamp"> & {
	readonly content: readonly CanonicalAssistantContent[];
};

export interface CanonicalAssistantEventSummary {
	readonly lifecycle: readonly Exclude<
		AssistantMessageEvent["type"],
		"text_delta" | "thinking_delta" | "toolcall_delta"
	>[];
	readonly text: readonly { readonly contentIndex: number; readonly value: string }[];
	readonly thinking: readonly { readonly contentIndex: number; readonly value: string }[];
	readonly toolArgumentsJson: readonly { readonly contentIndex: number; readonly value: string }[];
}

export interface CanonicalAssistantRun {
	readonly events: CanonicalAssistantEventSummary;
	readonly result: CanonicalAssistantMessage;
}

export function canonicalizeAssistantMessage(message: AssistantMessage): CanonicalAssistantMessage {
	return {
		role: message.role,
		content: message.content.map((content) => {
			if (content.type !== "toolCall") return { ...content };
			return {
				...content,
				arguments: canonicalizeJsonRecord(content.arguments),
			};
		}),
		api: message.api,
		provider: message.provider,
		model: message.model,
		usage: {
			...message.usage,
			cost: { ...message.usage.cost },
		},
		stopReason: message.stopReason,
		...(message.errorMessage === undefined ? {} : { errorMessage: message.errorMessage }),
	};
}

export function canonicalizeAssistantEvents(events: readonly AssistantMessageEvent[]): CanonicalAssistantEventSummary {
	const lifecycle: CanonicalAssistantEventSummary["lifecycle"][number][] = [];
	const text = new Map<number, string>();
	const thinking = new Map<number, string>();
	const toolArgumentsJson = new Map<number, string>();

	for (const event of events) {
		switch (event.type) {
			case "text_delta":
				append(text, event.contentIndex, event.delta);
				break;
			case "thinking_delta":
				append(thinking, event.contentIndex, event.delta);
				break;
			case "toolcall_delta":
				append(toolArgumentsJson, event.contentIndex, event.delta);
				break;
			default:
				lifecycle.push(event.type);
		}
	}

	return {
		lifecycle,
		text: mapEntries(text),
		thinking: mapEntries(thinking),
		toolArgumentsJson: mapEntries(toolArgumentsJson),
	};
}

export function canonicalizeAssistantRun(
	events: readonly AssistantMessageEvent[],
	result: AssistantMessage,
): CanonicalAssistantRun {
	return {
		events: canonicalizeAssistantEvents(events),
		result: canonicalizeAssistantMessage(result),
	};
}

function append(target: Map<number, string>, contentIndex: number, delta: string): void {
	target.set(contentIndex, `${target.get(contentIndex) ?? ""}${delta}`);
}

function mapEntries(source: ReadonlyMap<number, string>): { contentIndex: number; value: string }[] {
	return [...source.entries()]
		.sort(([left], [right]) => left - right)
		.map(([contentIndex, value]) => ({ contentIndex, value }));
}

export function canonicalizeJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalizeJsonValue);
	if (isRecord(value)) return canonicalizeJsonRecord(value);
	return value;
}

function canonicalizeJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, canonicalizeJsonValue(item)]),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}
