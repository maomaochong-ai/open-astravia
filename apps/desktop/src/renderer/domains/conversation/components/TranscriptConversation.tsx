import type { ChatConversationItem } from "@shared/store/chat-atoms";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import { Conversation, useSnapshotConversationFeed } from "../conversation-view";

export interface TranscriptConversationProps {
	/** The transcript's path; scopes scroll position and expansion state. */
	readonly feedKey: string | null;
	readonly messages: readonly ChatConversationItem[];
	readonly workspace: ActivityWorkspace;
	readonly isStreaming?: boolean;
}

/**
 * A read-only transcript (session viewer, workflow child session): messages with
 * copy actions and the question index, no session commands.
 */
export function TranscriptConversation({ feedKey, messages, workspace, isStreaming }: TranscriptConversationProps) {
	const feed = useSnapshotConversationFeed({
		key: feedKey,
		messages,
		workspace,
		...(isStreaming !== undefined ? { isStreaming } : {}),
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
