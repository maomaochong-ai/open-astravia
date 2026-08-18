import type { ChatMessage } from "@shared/store/atoms";
import { UserMessageContextMenuView, UserMessageView } from "@vetta/theme-ui/chat";
import { memo } from "react";
import { createPortal } from "react-dom";
import { useUserMessageModel } from "../../hooks/useUserMessageModel";

interface UserMessageProps {
	hasAssistantAfter?: boolean;
	isLastUserMessage?: boolean;
	isStreaming?: boolean;
	message: ChatMessage;
	onAbortEdit?: () => void;
}

export const UserMessage = memo(function UserMessage(props: UserMessageProps) {
	const { contextMenu, ...viewModel } = useUserMessageModel(props);
	return (
		<>
			<UserMessageView {...viewModel} />
			{contextMenu ? createPortal(<UserMessageContextMenuView {...contextMenu} />, document.body) : null}
		</>
	);
});
