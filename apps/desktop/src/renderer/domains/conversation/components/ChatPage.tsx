import { abortMessageFnRef, sendMessageFnRef, sendQueuedNowFnRef } from "@shared/store/atoms";
import { useCallback } from "react";
import { useChatPageModel } from "../hooks/useChatPageModel";
import { ChatPageView } from "./chat-page/ChatPageView";
import type { SendInteractionContext } from "./input-bar/types";

export function ChatPage(): JSX.Element | null {
	const model = useChatPageModel();
	// 会话打开/发送只在 RootLayout 挂一份 useSessionManager；这里走模块级 ref，
	// 避免 ChatPage 再挂一份实例把 send/abort 身份搅乱。
	const handleSend = useCallback(async (overrideText?: string, context?: SendInteractionContext) => {
		await sendMessageFnRef.current?.(
			overrideText,
			context
				? {
						interactionId: context.interactionId,
						streamingBehavior: context.streamingBehavior,
					}
				: undefined,
		);
	}, []);
	const handleAbort = useCallback(async () => {
		await abortMessageFnRef.current?.();
	}, []);
	const handleSendQueued = useCallback(async (runtimeId: string, id: string) => {
		await sendQueuedNowFnRef.current?.(runtimeId, id);
	}, []);

	return (
		<ChatPageView model={model} onSend={handleSend} onAbort={handleAbort} onSendQueued={handleSendQueued} />
	);
}
