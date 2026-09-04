import type { ToolPhase } from "@vetta/agent-core";
import type { AssistantMessageEvent } from "@vetta/ai";
import type { RuntimeToolResult } from "../kernel/contracts.js";
import type { ConversationAgentAuthorReference } from "./message-contract.js";

/** Product-neutral identity envelope for one Agent message protocol event. */
export interface ConversationAgentMessageEvent {
	readonly type: "conversation.agent-message-event";
	readonly conversationId: string;
	readonly messageId: string;
	readonly turnId: string;
	readonly author: ConversationAgentAuthorReference;
	readonly sequence: number;
	readonly timestamp: number;
	readonly event: AssistantMessageEvent;
}

/**
 * Removes a non-durable live projection without manufacturing an Agent message.
 * Durable waiting/failure details remain owned by the product's work-item model.
 */
export interface ConversationAgentMessageDiscardEvent {
	readonly type: "conversation.agent-message-discard";
	readonly conversationId: string;
	readonly messageId: string;
	readonly turnId: string;
	readonly author: ConversationAgentAuthorReference;
	readonly sequence: number;
	readonly timestamp: number;
	readonly reason: "completed" | "waiting" | "failed" | "aborted";
	readonly error?: string;
}

/**
 * Execution side effects for a tool call already present in an Agent message.
 *
 * These events are renderer-facing only. They update the message projection and
 * are never added to the model-visible Conversation history.
 */
export interface ConversationToolExecutionEvent {
	readonly type: "conversation.tool-execution";
	readonly conversationId: string;
	readonly messageId: string;
	readonly turnId: string;
	readonly author: ConversationAgentAuthorReference;
	readonly sequence: number;
	readonly timestamp: number;
	readonly event:
		| {
				readonly type: "start";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly args: unknown;
				readonly startedAt: number;
		  }
		| {
				readonly type: "update";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly partialResult: RuntimeToolResult;
		  }
		| {
				readonly type: "phase";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly label: string;
				readonly atMs: number;
		  }
		| {
				readonly type: "end";
				readonly toolCallId: string;
				readonly toolName: string;
				readonly result: RuntimeToolResult;
				readonly isError: boolean;
				readonly startedAt: number;
				readonly durationMs: number;
				readonly phases: readonly ToolPhase[];
		  };
}

export type ConversationMessageStreamEvent =
	| ConversationAgentMessageEvent
	| ConversationAgentMessageDiscardEvent
	| ConversationToolExecutionEvent;
