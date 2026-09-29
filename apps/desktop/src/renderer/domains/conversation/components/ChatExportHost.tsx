import type { ChatConversationItem } from "@shared/store/atoms";
import type { ConversationParticipantViewModel } from "@shared/conversation";
import { ChatExportHostView } from "@vetta-org/theme-ui/chat";
import { useChatExportHostModel } from "../hooks/useChatExportHostModel";
import { ExportMessageList } from "./MessageList";

interface ChatExportHostProps {
	messages: readonly ChatConversationItem[];
	participants?: readonly ConversationParticipantViewModel[];
	title: string;
	onFinished: () => void;
}

export function ChatExportHost({ messages, participants, title, onFinished }: ChatExportHostProps): JSX.Element {
	const model = useChatExportHostModel({ messages, title, onFinished });
	return (
		<ChatExportHostView>
			<ExportMessageList ref={model.rootRef} messages={messages} participants={participants} />
		</ChatExportHostView>
	);
}
