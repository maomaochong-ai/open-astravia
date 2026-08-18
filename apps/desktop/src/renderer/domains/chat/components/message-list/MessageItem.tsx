import {
	CompactionBoundaryView,
	ExportMessageListView,
	MessageItemView,
	ModelSwitchBoundaryView,
} from "@vetta/theme-ui/chat";
import { forwardRef, memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "./types";
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
	message: ChatMessage;
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
	if (message.role === "compaction") {
		return (
			<MessageItemView>
				<CompactionBoundary />
			</MessageItemView>
		);
	}
	if (message.role === "user") {
		return (
			<MessageItemView>
				<UserMessage
					message={message}
					isLastUserMessage={isLastUserMessage}
					hasAssistantAfter={hasAssistantAfter}
					isStreaming={isStreaming}
					onAbortEdit={onAbortEdit}
				/>
			</MessageItemView>
		);
	}
	return (
		<MessageItemView>
			<AssistantMessage
				message={message}
				isTailMessage={isTailMessage}
				isStreaming={isStreaming}
				exportMode={exportMode}
			/>
		</MessageItemView>
	);
});

export const ExportMessageList = forwardRef<HTMLDivElement, { messages: ChatMessage[] }>(
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
