import { type ConversationMessageEventState, reduceConversationMessageEvent } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/atoms";
import type { AssistantSessionEvent, HistoryEntry } from "@vetta/runtime-core";
import type { ConversationAgentMessageEvent } from "@vetta/runtime-core/conversation";
import { fullHistoryToChat, resetStreamState } from "./chat-service";

interface QueuedAssistantEvent {
	readonly event: AssistantSessionEvent;
	readonly sequence: number;
}

/**
 * Chat connector for the shared identity-scoped Conversation message reducer.
 * Runtime events remain lossless; batching changes only React commit frequency.
 */
export class ConversationProjection {
	private pendingAssistantEvents: QueuedAssistantEvent[] = [];
	private lastHostSequence: number | undefined;
	private localSequence = 0;
	private rawAssistantStream = false;
	private targetMessageId: string | undefined;

	projectHistory(history: HistoryEntry[]): ChatConversationItem[] {
		return fullHistoryToChat(history);
	}

	enqueue(event: AssistantSessionEvent): void {
		if (
			event.sequence !== undefined &&
			this.lastHostSequence !== undefined &&
			event.sequence <= this.lastHostSequence
		) {
			return;
		}
		if (event.sequence !== undefined) this.lastHostSequence = event.sequence;
		this.localSequence = Math.max(this.localSequence + 1, event.sequence ?? 0);
		this.rawAssistantStream = true;
		this.pendingAssistantEvents.push({ event, sequence: this.localSequence });
	}

	hasRawAssistantStream(): boolean {
		return this.rawAssistantStream;
	}

	hasPendingEvents(): boolean {
		return this.pendingAssistantEvents.length > 0;
	}

	flush(messages: ChatConversationItem[]): ChatConversationItem[] {
		const pending = this.pendingAssistantEvents;
		this.pendingAssistantEvents = [];
		if (pending.length === 0) return messages;

		const first = pending[0];
		if (!first) return messages;
		const existing = findTargetAgentMessage(messages, this.targetMessageId);
		this.targetMessageId ??=
			existing?.id ?? `assistant:${first.event.sessionId}:${first.event.turnId ?? "unscoped-turn"}`;
		let state: ConversationMessageEventState | undefined = existing
			? { conversationId: first.event.sessionId, sequence: -1, message: existing }
			: undefined;
		for (const queued of pending) {
			state = reduceConversationMessageEvent(state, toConversationEnvelope(queued, this.targetMessageId));
		}
		if (!state) return messages;

		const index = messages.findIndex((item) => item.kind === "agent" && item.id === state?.message.id);
		if (index < 0) return [...messages, state.message];
		const next = [...messages];
		next[index] = state.message;
		return next;
	}

	reset(): void {
		this.pendingAssistantEvents = [];
		this.lastHostSequence = undefined;
		this.localSequence = 0;
		this.rawAssistantStream = false;
		this.targetMessageId = undefined;
		resetStreamState();
	}
}

function findTargetAgentMessage(messages: readonly ChatConversationItem[], targetMessageId: string | undefined) {
	if (targetMessageId) {
		const target = messages.find((item) => item.kind === "agent" && item.id === targetMessageId);
		if (target?.kind === "agent") return target;
	}
	const tail = messages.at(-1);
	return tail?.kind === "agent" && tail.phase === "streaming" ? tail : undefined;
}

function toConversationEnvelope(queued: QueuedAssistantEvent, messageId: string): ConversationAgentMessageEvent {
	const { event, sequence } = queued;
	return {
		type: "conversation.agent-message-event",
		conversationId: event.sessionId,
		messageId,
		turnId: event.turnId ?? messageId,
		author: { kind: "agent", id: "default-agent" },
		sequence,
		timestamp: event.timestamp,
		event,
	};
}
