import { useCallback } from "react";
import { useChatPageModel } from "../hooks/useChatPageModel";
import { useSessionManager } from "../hooks/useSessionManager";
import { ChatPageView } from "./chat-page/ChatPageView";
import type { SendInteractionContext } from "./input-bar/types";

export function ChatPage(): JSX.Element | null {
	const model = useChatPageModel();
	const { sendMessage, abortMessage, sendQueuedNow } = useSessionManager();
	// 视图层不关心 sendMessage 的回执（queued/sent），收窄为 void 保持 props 稳定。
	const handleSend = useCallback(
		async (overrideText?: string, context?: SendInteractionContext) => {
			await sendMessage(overrideText, context ? { interactionId: context.interactionId } : undefined);
		},
		[sendMessage],
	);

	return (
		<ChatPageView model={model} onSend={handleSend} onAbort={abortMessage} onSendQueued={sendQueuedNow} />
	);
}
