import type { DesktopTeamToolExecutionEvent } from "@preload/api-types/team-conversation-display";
import {
	type ConversationMessageEventState,
	createConversationAgentMessage,
	projectAssistantMessageBlocks,
} from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/atoms";
import type { AssistantMessage } from "@vetta/ai";
import type { ConversationToolExecutionEvent } from "@vetta/runtime-core/conversation";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { withToolCallEnded, withToolCallPhase, withToolCallStarted } from "./chat-service";

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
	const phase = message.stopReason === "aborted" ? "aborted" : message.stopReason === "error" ? "failed" : "completed";
	const toolStatus = phase === "aborted" ? "cancelled" : phase === "failed" ? "error" : "pending";
	let projected = createConversationAgentMessage({
		id: messageId,
		entryId: entryId ?? messageId,
		turnId: turnId ?? messageId,
		authorId: authorId,
		timestamp: timestamp ?? message.timestamp,
		phase,
		text: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
		blocks: projectAssistantMessageBlocks(message, messageId, toolStatus),
	});
	for (const execution of executions.filter((item) => item.messageId === messageId)) {
		const hasCall = projected.blocks.some(
			(block) => block.type === "tool_call" && block.toolCallId === execution.toolCallId,
		);
		if (!hasCall) {
			projected = withToolCallStarted(
				projected,
				execution.toolCallId,
				execution.toolName,
				execution.args,
				execution.startedAt,
			);
		}
		for (const phase of execution.phases ?? []) {
			projected = withToolCallPhase(projected, execution.toolCallId, phase.label, phase.atMs);
		}
		if (execution.result) {
			projected = withToolCallEnded(
				projected,
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
	return projected;
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
			message = withToolCallStarted(
				base,
				event.event.toolCallId,
				event.event.toolName,
				asRecord(event.event.args),
				event.event.startedAt,
			);
			break;
		case "phase":
			message = withToolCallPhase(base, event.event.toolCallId, event.event.label, event.event.atMs);
			break;
		case "end": {
			const started = withToolCallStarted(
				base,
				event.event.toolCallId,
				event.event.toolName,
				{},
				event.event.startedAt,
			);
			message = withToolCallEnded(started, event.event.toolCallId, event.event.result, event.event.isError, {
				startedAt: event.event.startedAt,
				durationMs: event.event.durationMs,
				phases: [...event.event.phases],
			});
			break;
		}
		case "update":
			// Partial results are intentionally not rendered as terminal output.
			// The final event carries the complete result and timing metadata.
			break;
	}
	return { conversationId: event.conversationId, sequence: event.sequence, message };
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
