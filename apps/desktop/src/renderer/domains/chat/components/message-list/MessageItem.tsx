import {
	CompactionBoundaryView,
	ExportMessageListView,
	ModelSwitchBoundaryView,
} from "@vetta/theme-ui/chat";
import { forwardRef, memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatConversationItem } from "./types";
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
}

export const MessageItem = memo(function MessageItem({
	message,
	isTailMessage,
	isStreaming,
	isLastUserMessage = false,
	hasAssistantAfter = false,
	onAbortEdit,
	exportMode = false,
}: MessageItemProps) {
	if (message.kind === "event") {
		return <CompactionBoundary />;
	}
	if (message.kind === "user") {
		return (
			<UserMessage
				message={message}
				isLastUserMessage={isLastUserMessage}
				hasAssistantAfter={hasAssistantAfter}
				isStreaming={isStreaming}
				onAbortEdit={onAbortEdit}
			/>
		);
	}
	return (
		<AssistantMessage
			message={message}
			isTailMessage={isTailMessage}
			isStreaming={isStreaming}
			exportMode={exportMode}
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
