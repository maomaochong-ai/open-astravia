import type { ConversationParticipantViewModel } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/chat-atoms";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import { atom } from "jotai";
import { useMemo } from "react";
import { type ConversationFeed, createConversationFeed } from "./feed";

export interface SnapshotConversationFeedInput {
	/** Scope of view state and the list identity, e.g. a transcript path or a Team feed key. */
	readonly key: string | null;
	readonly messages: readonly ChatConversationItem[];
	readonly isStreaming?: boolean;
	readonly workspace: ActivityWorkspace;
	readonly participants?: readonly ConversationParticipantViewModel[];
	readonly pendingLabel?: string;
	readonly openTeamMember?: (memberId: string) => void;
}

/**
 * A feed over messages the caller already holds (a transcript read from disk, a
 * Team timeline). It offers no session commands; a new message array replaces
 * the feed's items.
 */
export function useSnapshotConversationFeed({
	key,
	messages,
	isStreaming = false,
	workspace,
	participants,
	pendingLabel,
	openTeamMember,
}: SnapshotConversationFeedInput): ConversationFeed {
	const items = useMemo(() => atom(messages), [messages]);
	const streaming = useMemo(() => atom(isStreaming), [isStreaming]);
	return useMemo(
		() =>
			createConversationFeed({
				key,
				items,
				streaming,
				workspace,
				...(participants ? { participants } : {}),
				...(pendingLabel ? { pendingLabel } : {}),
				capabilities: openTeamMember ? { openTeamMember } : {},
			}),
		[key, items, streaming, workspace, participants, pendingLabel, openTeamMember],
	);
}
