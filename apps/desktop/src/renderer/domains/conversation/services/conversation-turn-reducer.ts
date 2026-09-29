import {
	abortConversationAgentMessage,
	type ConversationUserMessageViewModel,
	createConversationAgentMessage,
	createConversationUserMessage,
} from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/atoms";
import type { ConversationMessageAppendedEvent, ConversationTurnEvent } from "@vetta/runtime-core";

/** Create or adopt only the draft owned by `turnId`. */
export function startConversationTurn(
	messages: readonly ChatConversationItem[],
	turnId: string,
	messageId: string,
	startedAt: number,
): ChatConversationItem[] {
	let existing = messages.findIndex((item) => item.kind === "agent" && item.id === messageId);
	if (existing < 0) {
		const tail = messages.at(-1);
		if (
			tail?.kind === "agent" &&
			tail.id.startsWith("draft-") &&
			tail.turnId === tail.id &&
			tail.endedAt === undefined
		) {
			existing = messages.length - 1;
		}
	}
	if (existing >= 0) {
		const item = messages[existing];
		if (item.kind !== "agent") return [...messages];
		if (item.id === messageId && item.startedAt !== undefined) return [...messages];
		const next = [...messages];
		next[existing] = {
			...item,
			id: messageId,
			turnId,
			phase: "streaming",
			startedAt: item.startedAt ?? startedAt,
			timestamp: item.timestamp ?? startedAt,
			endedAt: undefined,
			durationSeconds: undefined,
		};
		return next;
	}
	return [
		...messages,
		createConversationAgentMessage({
			id: messageId,
			turnId,
			phase: "streaming",
			text: "",
			blocks: [],
			timestamp: startedAt,
			startedAt,
		}),
	];
}

/**
 * Commit a durable user message by exact identity and keep the Turn draft
 * immediately after it. This handles both optimistic sends and queue-promoted
 * messages without inspecting queue snapshot disappearance or matching text.
 */
export function commitConversationUserMessage(
	messages: readonly ChatConversationItem[],
	event: ConversationMessageAppendedEvent,
	nextAssistantMessageId: string,
	optimisticMessage?: ConversationUserMessageViewModel,
): ChatConversationItem[] {
	if (event.message.role !== "user") return [...messages];
	const text = messageText(event.message.content);
	const userIndex = messages.findIndex((item) => item.kind === "user" && item.id === event.messageId);
	const assistantIndex = findLastAssistantIndex(messages, event.turnId);
	const assistant = assistantIndex >= 0 ? messages[assistantIndex] : undefined;
	const reusesEmptyDraft =
		assistant?.kind === "agent" &&
		assistant.endedAt === undefined &&
		assistant.blocks.length === 0 &&
		!assistant.text;
	const existingUser = userIndex >= 0 ? messages[userIndex] : optimisticMessage;
	const committedUser =
		existingUser?.kind === "user"
			? {
					...existingUser,
					entryId: event.messageId,
					turnId: event.turnId,
					deliveryPhase: "completed" as const,
					text,
					timestamp: existingUser.timestamp ?? event.message.timestamp ?? event.timestamp,
				}
			: createConversationUserMessage({
					id: event.messageId,
					entryId: event.messageId,
					turnId: event.turnId,
					deliveryPhase: "completed",
					text,
					timestamp: event.message.timestamp ?? event.timestamp,
				});
	const draft =
		reusesEmptyDraft && assistant?.kind === "agent"
			? { ...assistant, id: nextAssistantMessageId, turnId: event.turnId }
			: createConversationAgentMessage({
					id: nextAssistantMessageId,
					turnId: event.turnId,
					phase: "streaming",
					text: "",
					blocks: [],
					timestamp: event.timestamp,
					startedAt: event.timestamp,
				});
	const next = messages
		.map((item, index) =>
			index === assistantIndex && !reusesEmptyDraft && item.kind === "agent" && item.endedAt === undefined
				? finishSegment(item, event.timestamp)
				: item,
		)
		.filter((_item, index) => index !== userIndex && !(reusesEmptyDraft && index === assistantIndex));
	const insertionIndex =
		userIndex >= 0
			? messages.slice(0, userIndex).filter((_item, index) => !(reusesEmptyDraft && index === assistantIndex)).length
			: reusesEmptyDraft
				? Math.min(assistantIndex, next.length)
				: assistant?.kind === "agent"
					? next.findIndex((item) => item.kind === "agent" && item.id === assistant.id) + 1
					: next.length;
	next.splice(insertionIndex, 0, committedUser);
	next.splice(insertionIndex + 1, 0, draft);
	return next;
}

export function markConversationModelRequestStarted(
	messages: readonly ChatConversationItem[],
	turnId: string,
	messageId: string,
	timestamp: number,
): ChatConversationItem[] {
	const started = startConversationTurn(messages, turnId, messageId, timestamp);
	return started.map((item) =>
		item.kind === "agent" && item.turnId === turnId && item.modelRequestStartedAt === undefined
			? { ...item, modelRequestStartedAt: timestamp }
			: item,
	);
}

/** Settle only the assistant message owned by the terminal Turn. */
export function finishConversationTurn(
	messages: readonly ChatConversationItem[],
	event: Exclude<ConversationTurnEvent, { readonly type: "conversation.turn.started" }>,
): ChatConversationItem[] {
	const index = findLastAssistantIndex(messages, event.turnId);
	if (index < 0) return [...messages];
	const item = messages[index];
	if (item.kind !== "agent") return [...messages];
	const next = [...messages];
	if (event.type === "conversation.turn.cancelled") {
		next[index] = abortConversationAgentMessage(item, event.timestamp);
		return next;
	}
	const failed = event.type === "conversation.turn.failed" || item.blocks.some((block) => block.type === "error");
	next[index] = {
		...item,
		phase: failed ? "failed" : "completed",
		endedAt: event.timestamp,
		...(item.startedAt === undefined
			? {}
			: { durationSeconds: Math.max(0, event.timestamp - item.startedAt) / 1_000 }),
	};
	return next;
}

function findLastAssistantIndex(messages: readonly ChatConversationItem[], turnId: string): number {
	for (let index = messages.length - 1; index >= 0; index--) {
		const item = messages[index];
		if (item.kind === "agent" && item.turnId === turnId) return index;
	}
	return -1;
}

function finishSegment(
	message: Extract<ChatConversationItem, { readonly kind: "agent" }>,
	endedAt: number,
): Extract<ChatConversationItem, { readonly kind: "agent" }> {
	return {
		...message,
		phase: message.blocks.some((block) => block.type === "error") ? "failed" : "completed",
		endedAt,
		...(message.startedAt === undefined ? {} : { durationSeconds: Math.max(0, endedAt - message.startedAt) / 1_000 }),
	};
}

function messageText(content: ConversationMessageAppendedEvent["message"]["content"]): string {
	if (typeof content === "string") return content;
	return content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}
