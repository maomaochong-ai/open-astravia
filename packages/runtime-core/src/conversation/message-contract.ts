import type { AssistantMessage, UserMessage } from "@vetta/ai";
import type { PromptAttachmentRef } from "../contracts.js";

/** Stable reference to a user who authored a Conversation message. */
export interface ConversationUserAuthorReference {
	readonly kind: "user";
	readonly id: string;
}

/** Stable reference to an Agent who authored a Conversation message. */
export interface ConversationAgentAuthorReference {
	readonly kind: "agent";
	/** Stable participant identity inside the Conversation. */
	readonly id: string;
	/** Optional Agent Definition/Profile identity shared across Conversations. */
	readonly agentId?: string;
}

export type ConversationAuthorReference = ConversationUserAuthorReference | ConversationAgentAuthorReference;

export interface ConversationMessageRecordBase {
	readonly id: string;
	readonly turnId: string;
	readonly timestamp: number;
}

export interface ConversationUserMessageRecord extends ConversationMessageRecordBase {
	readonly kind: "user";
	readonly author: ConversationUserAuthorReference;
	readonly message: UserMessage;
	/** Prompt attachments belong to user input and cannot occur on Agent messages. */
	readonly attachments?: readonly PromptAttachmentRef[];
}

export interface ConversationAgentMessageRecord extends ConversationMessageRecordBase {
	readonly kind: "agent";
	readonly author: ConversationAgentAuthorReference;
	readonly message: AssistantMessage;
}

export type ConversationMessageRecord = ConversationUserMessageRecord | ConversationAgentMessageRecord;

export function isConversationMessageRecord(value: unknown): value is ConversationMessageRecord {
	if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.turnId)) return false;
	if (!Number.isFinite(value.timestamp) || !isRecord(value.author) || !isRecord(value.message)) return false;
	if (value.kind === "user") {
		return (
			value.author.kind === "user" &&
			isNonEmptyString(value.author.id) &&
			value.message.role === "user" &&
			(value.attachments === undefined || Array.isArray(value.attachments))
		);
	}
	return (
		value.kind === "agent" &&
		value.author.kind === "agent" &&
		isNonEmptyString(value.author.id) &&
		(value.author.agentId === undefined || isNonEmptyString(value.author.agentId)) &&
		value.message.role === "assistant" &&
		!("attachments" in value)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}
