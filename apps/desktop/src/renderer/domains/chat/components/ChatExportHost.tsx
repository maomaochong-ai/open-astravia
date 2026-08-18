import type { ChatMessage } from "@shared/store/atoms";
import { ChatExportHostView } from "@vetta/theme-ui/chat";
import { useChatExportHostModel } from "../hooks/useChatExportHostModel";
import { ExportMessageList } from "./MessageList";

interface ChatExportHostProps {
	messages: ChatMessage[];
	title: string;
	onFinished: () => void;
}

export function ChatExportHost({ messages, title, onFinished }: ChatExportHostProps): JSX.Element {
	const model = useChatExportHostModel({ messages, title, onFinished });
	return (
		<ChatExportHostView>
			<ExportMessageList ref={model.rootRef} messages={messages} />
		</ChatExportHostView>
	);
}
