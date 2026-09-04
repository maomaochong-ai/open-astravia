import type { DesktopTeamToolExecutionEvent } from "@preload/api-types/team-conversation-display";
import {
	type ConversationMessageEventState,
	createConversationAgentMessage,
	projectAssistantMessageBlocks,
	reduceConversationMessageEvent,
} from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/atoms";
import type { AssistantMessage } from "@vetta/ai";
import type { AssistantSessionEvent, HistoryEntry } from "@vetta/runtime-core";
import type { ConversationAgentMessageEvent, ConversationToolExecutionEvent } from "@vetta/runtime-core/conversation";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { fullHistoryToChat, handleToolEnd, handleToolPhase, handleToolStart, resetStreamState } from "./chat-service";

interface QueuedAssistantEvent {
	readonly event: AssistantSessionEvent;
	readonly sequence: number;
}

export interface ConversationToolExecutionProjection {
	readonly messageId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly args: Record<string, unknown>;
	readonly result?: RuntimeToolResult;
	readonly isError?: boolean;
	readonly startedAt?: number;
	readonly durationMs?: number;
	readonly phases?: readonly { readonly label: string; readonly atMs: number }[];
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

/**
 * Projects a persisted assistant message through the same block contract used
 * by the ordinary conversation. Execution observations are only an optional
 * Desktop display input; they never create a second Team message model.
 */
export function projectConversationAgentMessage(input: {
	readonly message: AssistantMessage;
	readonly messageId: string;
	readonly entryId?: string;
	readonly turnId?: string;
	readonly authorId?: string;
	readonly timestamp?: number;
	readonly executions?: readonly ConversationToolExecutionProjection[];
}): ChatConversationItem {
	const { message, messageId, entryId, turnId, authorId, timestamp, executions = [] } = input;
	let items: ChatConversationItem[] = [
		createConversationAgentMessage({
			id: messageId,
			entryId: entryId ?? messageId,
			turnId: turnId ?? messageId,
			authorId: authorId,
			timestamp: timestamp ?? message.timestamp,
			text: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
			blocks: projectAssistantMessageBlocks(message, messageId),
		}),
	];
	for (const execution of executions.filter((item) => item.messageId === messageId)) {
		const current = items[0];
		const hasCall =
			current?.kind === "agent" &&
			current.blocks.some((block) => block.type === "tool_call" && block.toolCallId === execution.toolCallId);
		if (!hasCall) {
			items = handleToolStart(items, execution.toolCallId, execution.toolName, execution.args, execution.startedAt);
		}
		for (const phase of execution.phases ?? []) {
			items = handleToolPhase(items, execution.toolCallId, phase.label, phase.atMs);
		}
		if (execution.result) {
			items = handleToolEnd(
				items,
				execution.toolCallId,
				execution.result,
				execution.isError === true,
				execution.startedAt !== undefined && execution.durationMs !== undefined
					? {
							startedAt: execution.startedAt,
							durationMs: execution.durationMs,
							phases: [...(execution.phases ?? [])],
						}
					: undefined,
			);
		}
	}
	const result = items[0];
	if (!result) throw new Error("Assistant message projection produced no message");
	return result;
}

/**
 * Applies execution-only tool events to the same Agent message projection used
 * by ordinary Chat. The events are deliberately kept outside Conversation
 * history so Team can expose tool cards without leaking execution details into
 * the model context or changing the storage contract.
 */
export function reduceConversationToolExecutionEvent(
	state: ConversationMessageEventState | undefined,
	event: DesktopTeamToolExecutionEvent | ConversationToolExecutionEvent,
): ConversationMessageEventState {
	if (state && (state.conversationId !== event.conversationId || state.message.id !== event.messageId)) {
		throw new Error("Conversation tool execution event does not match its reduction state");
	}
	if (state && event.sequence <= state.sequence) return state;

	const base =
		state?.message ??
		createConversationAgentMessage({
			id: event.messageId,
			entryId: event.messageId,
			turnId: event.turnId,
			authorId: event.author.id,
			phase: "streaming",
			text: "",
			blocks: [],
			timestamp: event.timestamp,
			startedAt: event.timestamp,
		});
	let message = base;
	switch (event.event.type) {
		case "start":
			message = requireAgentMessage(
				handleToolStart(
					[base],
					event.event.toolCallId,
					event.event.toolName,
					asRecord(event.event.args),
					event.event.startedAt,
				)[0],
			);
			break;
		case "phase":
			message = requireAgentMessage(
				handleToolPhase([base], event.event.toolCallId, event.event.label, event.event.atMs)[0],
			);
			break;
		case "end": {
			const started = base.blocks.some(
				(block) => block.type === "tool_call" && block.toolCallId === event.event.toolCallId,
			)
				? [base]
				: handleToolStart([base], event.event.toolCallId, event.event.toolName, {}, event.event.startedAt);
			message = requireAgentMessage(
				handleToolEnd(started, event.event.toolCallId, event.event.result, event.event.isError, {
					startedAt: event.event.startedAt,
					durationMs: event.event.durationMs,
					phases: [...event.event.phases],
				})[0],
			);
			break;
		}
		case "update":
			// Partial results are intentionally not rendered as terminal output.
			// The final event carries the complete result and timing metadata.
			break;
	}
	return { conversationId: event.conversationId, sequence: event.sequence, message };
}

function requireAgentMessage(message: ChatConversationItem | undefined) {
	if (!message || message.kind !== "agent")
		throw new Error("Tool execution projection did not produce an Agent message");
	return message;
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
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
