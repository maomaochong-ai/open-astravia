import type { ChatTimelineEventViewModel } from "@shared/store/chat-atoms";
import { createContext, type ReactNode, useContext } from "react";
import { TeamMemberReplyCard } from "../components/message-list/TeamMemberReplyCard";
import { CompactionBoundary, DelegationNotice } from "../components/message-list/TimelineEventViews";
import { useConversationCapability } from "./feed";
import { useMessageRow } from "./message-scope";

const EventContext = createContext<ChatTimelineEventViewModel | null>(null);

function useEvent(part: string): ChatTimelineEventViewModel {
	const event = useContext(EventContext);
	if (!event) throw new Error(`${part} must be rendered inside <EventMessage.Root>`);
	return event;
}

/** A timeline event in the row of the enclosing `<Conversation.EventMessage>` template. */
function EventMessageRoot({ children }: { readonly children?: ReactNode }) {
	const { message } = useMessageRow("EventMessage.Root");
	if (message.kind !== "event") return null;
	return <EventContext.Provider value={message.event}>{children}</EventContext.Provider>;
}

/** The boundary where earlier history was compacted into a summary. */
function EventMessageCompaction() {
	return useEvent("EventMessage.Compaction").kind === "compaction" ? <CompactionBoundary /> : null;
}

/** A task delegated to another agent. */
function EventMessageDelegation() {
	const event = useEvent("EventMessage.Delegation");
	return event.kind === "delegation" ? <DelegationNotice label={event.label} /> : null;
}

/**
 * A Team member's progress and reply. It links to the member's conversation
 * when the feed can open it.
 */
function EventMessageTeamMemberReply() {
	const event = useEvent("EventMessage.TeamMemberReply");
	const openTeamMember = useConversationCapability("openTeamMember");
	return event.kind === "team-member-summary" ? <TeamMemberReplyCard event={event} onOpen={openTeamMember} /> : null;
}

/** Every event kind with its standard presentation. */
function EventMessageBody() {
	return (
		<>
			<EventMessageCompaction />
			<EventMessageDelegation />
			<EventMessageTeamMemberReply />
		</>
	);
}

/** Parts for `<Conversation.EventMessage>` templates (ADR-0147); each renders only its own kind. */
export const EventMessage = {
	Root: EventMessageRoot,
	Compaction: EventMessageCompaction,
	Delegation: EventMessageDelegation,
	TeamMemberReply: EventMessageTeamMemberReply,
	Body: EventMessageBody,
} as const;
