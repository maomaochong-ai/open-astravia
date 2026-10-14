import type { ConversationParticipantViewModel } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/chat-atoms";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import { Conversation, useSnapshotConversationFeed } from "../../conversation-view";

export interface TeamConversationProps {
	readonly feedKey: string;
	readonly messages: readonly ChatConversationItem[];
	readonly workspace: ActivityWorkspace;
	readonly isStreaming: boolean;
	readonly participants: readonly ConversationParticipantViewModel[];
	readonly pendingLabel?: string;
	readonly onOpenMember: (memberId: string) => void;
}

/**
 * A Team timeline: replies under each member's name and avatar, member reply
 * cards that open the member's conversation, and the question index.
 */
export function TeamConversation({
	feedKey,
	messages,
	workspace,
	isStreaming,
	participants,
	pendingLabel,
	onOpenMember,
}: TeamConversationProps) {
	const feed = useSnapshotConversationFeed({
		key: feedKey,
		messages,
		isStreaming,
		workspace,
		participants,
		...(pendingLabel ? { pendingLabel } : {}),
		openTeamMember: onOpenMember,
	});
	return (
		<Conversation.Root feed={feed}>
			<Conversation.Viewport>
				<Conversation.Messages />
				<Conversation.Footer />
				<Conversation.TimelineRail />
				<Conversation.ScrollToBottom />
			</Conversation.Viewport>
		</Conversation.Root>
	);
}
