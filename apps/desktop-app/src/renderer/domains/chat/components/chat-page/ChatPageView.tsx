import { ChatView } from "../ChatView";
import type { ChatPageViewProps } from "./types";

export function ChatPageView({
	model,
	onAbort,
	onSend,
	onSendQueued,
}: ChatPageViewProps): JSX.Element | null {
	if (!model.hasActiveSession) return null;

	return <ChatView onSend={onSend} onAbort={onAbort} onSendQueued={onSendQueued} />;
}
