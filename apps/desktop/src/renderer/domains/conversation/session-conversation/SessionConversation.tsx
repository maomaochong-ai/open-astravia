import type { ConversationParticipantViewModel } from "@shared/conversation";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import { SuggestionBubbles } from "../components/SuggestionBubbles";
import { Conversation } from "../conversation-view";
import {
	AgentAnnotationMarkers,
	ForkOriginExtension,
	SessionAnnotations,
	SessionSelectionMenu,
	SessionWaitingFooter,
} from "./session-extensions";
import { SessionAgentMessage } from "./SessionAgentMessage";
import { SessionUserMessage } from "./SessionUserMessage";
import { useSessionConversationFeed } from "./useSessionConversationFeed";

export interface SessionConversationProps {
	readonly sessionId: string | null;
	readonly workspace: ActivityWorkspace;
	readonly participants?: readonly ConversationParticipantViewModel[];
	readonly pendingLabel?: string;
	readonly onAbort?: () => void;
	readonly onSend?: (overrideText?: string) => Promise<void>;
}

/** The active session's conversation, composed from the parts it needs (ADR-0147). */
export function SessionConversation({
	sessionId,
	workspace,
	participants,
	pendingLabel,
	onAbort,
	onSend,
}: SessionConversationProps) {
	const feed = useSessionConversationFeed({ key: sessionId, workspace, participants, pendingLabel, abort: onAbort });
	return (
		<Conversation.Root feed={feed}>
			<SessionAnnotations>
				<SessionSelectionMenu>
					<Conversation.Viewport>
						<Conversation.Messages>
							<Conversation.UserMessage>
								<SessionUserMessage />
							</Conversation.UserMessage>
							<Conversation.AgentMessage>
								<SessionAgentMessage />
							</Conversation.AgentMessage>
						</Conversation.Messages>
						<Conversation.Footer>
							<SessionWaitingFooter />
							{onSend ? <SuggestionBubbles onSend={onSend} /> : null}
						</Conversation.Footer>
						<Conversation.TimelineRail />
						<Conversation.ScrollToBottom />
					</Conversation.Viewport>
				</SessionSelectionMenu>
			</SessionAnnotations>
			<ForkOriginExtension />
			<AgentAnnotationMarkers />
		</Conversation.Root>
	);
}
