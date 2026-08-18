import { useMessageListModel } from "../hooks/useMessageListModel";
import { MessageListView, ExportMessageList } from "./message-list/MessageListView";
import type { MessageListProps } from "./message-list/types";

export { ExportMessageList };

export function MessageList(props: MessageListProps): JSX.Element {
	const model = useMessageListModel(props);
	return (
		<MessageListView model={model} onSend={props.onSend} onAbort={props.onAbort} sessionId={props.sessionId} />
	);
}
