import type { Usage } from "@vetta/ai";
import type { PromptAttachmentRef, PromptResourceRef } from "@vetta/runtime-core";
import type { ContentBlock } from "./content-blocks";

export interface ConversationMessageViewModelBase {
	id: string;
	entryId?: string;
	/** Optional UI-only key for feeds that aggregate multiple storage scopes. */
	renderKey?: string;
	parentId?: string | null;
	turnId: string;
	authorId: string;
	timestamp?: number;
}

export interface ConversationUserMessageViewModel extends ConversationMessageViewModelBase {
	kind: "user";
	role: "user";
	deliveryPhase: "pending" | "completed" | "failed";
	text: string;
	branch?: ConversationMessageBranchViewModel;
	images?: ConversationMessageImageViewModel[];
	model?: { provider: string; id: string };
	appshot?: AppshotAttachment;
	mentionedFiles?: MentionedFile[];
	settingsAssistTabId?: string;
	promptRef?: PromptResourceRef;
	attachments?: PromptAttachmentRef[];
}

export interface ConversationAgentMessageViewModel extends ConversationMessageViewModelBase {
	kind: "agent";
	role: "assistant";
	phase: "pending" | "streaming" | "completed" | "failed" | "aborted" | "waiting";
	/** Optional derived plain text used by search/export; rich rendering always uses blocks. */
	text?: string;
	blocks: ContentBlock[];
	usages?: Usage[];
	startedAt?: number;
	endedAt?: number;
	durationSeconds?: number;
}

export type ConversationMessageViewModel = ConversationUserMessageViewModel | ConversationAgentMessageViewModel;

export interface ConversationMessageBranchViewModel {
	siblings: string[];
	index: number;
}

export interface ConversationMessageImageViewModel {
	data: string;
	mimeType: string;
	name: string;
}

export interface AppshotAttachment {
	id: string;
	appName: string;
	windowTitle: string;
	documentPath: string | null;
	imagePath: string | null;
	iconPath: string | null;
	textPath: string | null;
	capturedAt: number;
}

export interface MentionedFile {
	path: string;
	name: string;
	isDirectory: boolean;
	sizeBytes?: number;
}

export interface ConversationCompactionEventViewModel {
	readonly kind: "compaction";
	readonly summary: string;
}

export type ConversationTimelineItemViewModel<EventViewModel extends { readonly kind: string }> =
	| ConversationMessageViewModel
	| {
			readonly kind: "event";
			readonly id: string;
			readonly entryId?: string;
			/** Optional UI-only key for feeds that aggregate multiple storage scopes. */
			readonly renderKey?: string;
			readonly timestamp?: number;
			readonly event: EventViewModel;
	  };

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
