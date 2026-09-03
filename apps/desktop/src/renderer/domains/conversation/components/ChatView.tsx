import { useSetAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { pageHeaderLeftSlotAtom, pageHeaderRightSlotAtom } from "@shared/store/atoms";
import { useChatViewModel } from "../hooks/useChatViewModel";
import { ChatHeaderActionsView } from "./chat-view/ChatHeaderActionsView";
import { ChatHeaderNewSessionButton } from "./chat-view/ChatHeaderNewSessionButton";
import { DefaultChatView } from "./chat-view/DefaultChatView";
import { DefaultInputBarConnector } from "./input-bar/DefaultInputBarConnector";
import type { ChatViewProps } from "./chat-view/types";

export function ChatView(props: ChatViewProps): JSX.Element {
	const { actions, model } = useChatViewModel();
	const setHeaderRightSlot = useSetAtom(pageHeaderRightSlotAtom);
	const setHeaderLeftSlot = useSetAtom(pageHeaderLeftSlotAtom);
	const headerActions = useMemo(
		() => <ChatHeaderActionsView actions={actions} model={model.header} />,
		[actions, model.header],
	);

	useEffect(() => {
		setHeaderRightSlot(headerActions);
		return () => setHeaderRightSlot(null);
	}, [headerActions, setHeaderRightSlot]);

	useEffect(() => {
		setHeaderLeftSlot(<ChatHeaderNewSessionButton />);
		return () => setHeaderLeftSlot(null);
	}, [setHeaderLeftSlot]);

	return (
		<DefaultChatView
			messages={model.messages}
			isStreaming={model.isStreaming}
			sessionId={model.sessionId}
			rootClassName={model.rootClassName}
			onSend={props.onSend}
			onAbort={() => void props.onAbort()}
			exportState={
				model.exporting
					? { title: model.exportTitle, onFinished: actions.finishExport }
					: undefined
			}
		>
			<DefaultInputBarConnector
				onSend={props.onSend}
				onAbort={props.onAbort}
				onSendQueued={props.onSendQueued}
				cwdOverride={props.cwdOverride}
			/>
		</DefaultChatView>
	);
}
