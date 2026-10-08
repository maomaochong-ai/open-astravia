import { ExportMessageListView } from "@vetta-org/theme-ui/chat/ExportMessageListView";
import { ModelSwitchBoundaryView } from "@vetta-org/theme-ui/chat/MessageBoundaryViews";
import { forwardRef, memo } from "react";
import { useTranslation } from "react-i18next";
import type { Usage } from "@vetta/ai/protocol";
import type { ChatConversationItem } from "./types";
import type { ConversationParticipantViewModel } from "@shared/conversation";
import { AssistantMessage } from "./AssistantMessage";
import { TeamMemberReplyCard } from "./TeamMemberReplyCard";
import { ReadonlyUserMessage } from "./ReadonlyUserMessage";
import { CompactionBoundary, DelegationNotice } from "./TimelineEventViews";

export const ModelSwitchBoundary = memo(function ModelSwitchBoundary({ from, to }: { from: string; to: string }) {
	const { t } = useTranslation("chat");
	return <ModelSwitchBoundaryView prefix="" label={t("messageList.modelSwitched", { from, to })} />;
});

export interface MessageItemProps {
	exportMode?: boolean;
	isLastUserMessage?: boolean;
	isStreaming: boolean;
	isTailMessage: boolean;
	message: ChatConversationItem;
	onAbortEdit?: () => void;
	pendingLabel?: string;
	participant?: ConversationParticipantViewModel;
	participants?: readonly ConversationParticipantViewModel[];
	onTeamMemberOpen?: (memberId: string) => void;
	sessionUsages?: readonly Usage[];
}

/** A message from explicit props, outside a conversation feed (export). */
export const MessageItem = memo(function MessageItem({
	message,
	isTailMessage,
	isStreaming,
	pendingLabel,
	participant,
	participants,
	onTeamMemberOpen,
	sessionUsages,
	exportMode = false,
}: MessageItemProps) {
	if (message.kind === "event") {
		if (message.event.kind === "compaction") return <CompactionBoundary />;
		if (message.event.kind === "team-member-summary") {
			return <TeamMemberReplyCard event={message.event} onOpen={onTeamMemberOpen} />;
		}
		return <DelegationNotice label={message.event.label} />;
	}
	if (message.kind === "user") {
		return <ReadonlyUserMessage message={message} participants={participants} />;
	}
	return (
		<AssistantMessage
			message={message}
			isTailMessage={isTailMessage}
			isStreaming={isStreaming}
			pendingLabel={pendingLabel}
			onTeamMemberOpen={onTeamMemberOpen}
			exportMode={exportMode}
			participant={participant}
			sessionUsages={sessionUsages}
		/>
	);
});

export const ExportMessageList = forwardRef<
	HTMLDivElement,
	{
		messages: readonly ChatConversationItem[];
		participants?: readonly ConversationParticipantViewModel[];
	}
>(
	function ExportMessageList({ messages, participants = [] }, ref) {
		const tailMessageId = messages.at(-1)?.id ?? null;
		const participantsById = new Map(participants.map((participant) => [participant.id, participant]));
		return (
			<ExportMessageListView listRef={ref}>
				{messages.map((message) => (
					<div key={message.id} className="pb-5">
						<MessageItem
							message={message}
							isTailMessage={message.id === tailMessageId}
							isStreaming={false}
							exportMode
							participant={message.kind === "agent" ? participantsById.get(message.authorId) : undefined}
							participants={participants}
						/>
					</div>
				))}
			</ExportMessageListView>
		);
	},
);
