import type { Usage } from "@vetta/ai";
import type { PromptAttachmentRef } from "@vetta/runtime-core";
import type { ContentBlock } from "../store/chat-atoms";

export interface ConversationMessageViewModelBase {
	readonly id: string;
	readonly entryId?: string;
	readonly parentId?: string | null;
	readonly turnId: string;
	readonly authorId: string;
	readonly timestamp?: number;
}

export interface ConversationUserMessageViewModel extends ConversationMessageViewModelBase {
	readonly kind: "user";
	readonly role: "user";
	readonly deliveryPhase: "pending" | "completed" | "failed";
	readonly text: string;
	readonly images?: readonly { readonly id: string; readonly url: string; readonly alt: string }[];
	readonly attachments?: readonly PromptAttachmentRef[];
}

export interface ConversationAgentMessageViewModel extends ConversationMessageViewModelBase {
	readonly kind: "agent";
	readonly role: "assistant";
	readonly phase: "pending" | "streaming" | "completed" | "failed" | "aborted" | "waiting";
	readonly blocks: readonly ContentBlock[];
	readonly usages?: readonly Usage[];
	readonly startedAt?: number;
	readonly endedAt?: number;
	readonly durationSeconds?: number;
}

export type ConversationMessageViewModel = ConversationUserMessageViewModel | ConversationAgentMessageViewModel;

export interface ConversationParticipantViewModel {
	readonly id: string;
	readonly kind: "user" | "agent";
	readonly name: string;
	readonly avatar?: string;
	readonly blueprintId?: string;
}

export type ConversationFeedItemViewModel<EventViewModel> =
	| { readonly kind: "message"; readonly id: string; readonly message: ConversationMessageViewModel }
	| { readonly kind: "event"; readonly id: string; readonly event: EventViewModel };
