import {
	CompactionBoundaryView,
	ExportMessageListView,
	Message,
	MessageLayout,
	MessageVisual,
	ModelSwitchBoundaryView,
} from "@vetta/theme-ui/chat";
import { forwardRef, memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatConversationItem } from "./types";
import type { ConversationParticipantViewModel } from "@shared/conversation";
import { AssistantMessage } from "./AssistantMessage";
import { UserMessage } from "./UserMessage";

export const CompactionBoundary = memo(function CompactionBoundary() {
	const { t } = useTranslation("chat");
	return <CompactionBoundaryView label={t("messageList.compactionBoundary")} />;
});

export const ModelSwitchBoundary = memo(function ModelSwitchBoundary({
	label,
}: {
	label: string;
}) {
	const { t } = useTranslation("chat");
	// t includes name interpolation — pass preformatted label from host
	return (
		<ModelSwitchBoundaryView
			prefix=""
			label={t("messageList.modelSwitched", { name: label })}
		/>
	);
});

interface MessageItemProps {
	exportMode?: boolean;
	hasAssistantAfter?: boolean;
	isLastUserMessage?: boolean;
	isStreaming: boolean;
	isTailMessage: boolean;
	message: ChatConversationItem;
	onAbortEdit?: () => void;
	participant?: ConversationParticipantViewModel;
	userMessageActions?: { readonly edit: boolean; readonly fork: boolean; readonly delete: boolean };
}

export const MessageItem = memo(function MessageItem({
	message,
	isTailMessage,
	isStreaming,
	isLastUserMessage = false,
	hasAssistantAfter = false,
	onAbortEdit,
	participant,
	userMessageActions,
	exportMode = false,
}: MessageItemProps) {
	if (message.kind === "event") {
		if (message.event.kind === "compaction") return <CompactionBoundary />;
		return (
			<Message.Root>
				<MessageLayout.Event>
					<MessageVisual.EventBubble>
						<span className="icon-[solar--forward-linear] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						<span className="truncate">{message.event.label}</span>
					</MessageVisual.EventBubble>
				</MessageLayout.Event>
			</Message.Root>
		);
	}
	if (message.kind === "user") {
		return (
			<UserMessage
				message={message}
				isLastUserMessage={isLastUserMessage}
				hasAssistantAfter={hasAssistantAfter}
				isStreaming={isStreaming}
				onAbortEdit={onAbortEdit}
				actions={userMessageActions}
			/>
		);
	}
	return (
		<AssistantMessage
			message={message}
			isTailMessage={isTailMessage}
			isStreaming={isStreaming}
			exportMode={exportMode}
			participant={participant}
		/>
	);
});

export const ExportMessageList = forwardRef<HTMLDivElement, { messages: ChatConversationItem[] }>(
	function ExportMessageList({ messages }, ref) {
		const tailMessageId = messages.at(-1)?.id ?? null;
		return (
			<ExportMessageListView listRef={ref}>
				{messages.map((message) => (
					<div key={message.id} className="pb-5">
						<MessageItem
							message={message}
							isTailMessage={message.id === tailMessageId}
							isStreaming={false}
							exportMode
						/>
					</div>
				))}
			</ExportMessageListView>
		);
	},
);
