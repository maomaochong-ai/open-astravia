import type { AssistantMessageEvent } from "@vetta/ai";
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

export type ConversationMessageStreamEvent = ConversationAgentMessageEvent | ConversationAgentMessageDiscardEvent;
