import { useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo } from "react";
import { pageHeaderLeftSlotAtom, pageHeaderRightSlotAtom } from "@shared/store/atoms";
import { useActiveSessionRuntimeIds } from "@shared/workspace/active-session-runtime";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import { useBoundAgentParticipants } from "../hooks/useBoundAgentParticipants";
import { useChatViewModel } from "../hooks/useChatViewModel";
import { ChatHeaderActionsView } from "./chat-view/ChatHeaderActionsView";
import { ChatHeaderNewSessionButton } from "./chat-view/ChatHeaderNewSessionButton";
import { DefaultChatView, ChatComposer } from "./chat-view/DefaultChatView";
import { SessionMessageList } from "./SessionMessageList";
import { SessionAssistantRendering } from "./SessionAssistantRendering";
import { DefaultInputBarConnector } from "./input-bar/DefaultInputBarConnector";
import type { ChatViewProps } from "./chat-view/types";

const SessionFeed = memo(SessionMessageList);

export const DefaultChatComposer = memo(function DefaultChatComposer({
	onSend,
	onAbort,
	onSendQueued,
	cwdOverride,
}: ChatViewProps): JSX.Element {
	return (
		<ChatComposer>
			<DefaultInputBarConnector
				onSend={onSend}
				onAbort={onAbort}
				onSendQueued={onSendQueued}
				cwdOverride={cwdOverride}
			/>
		</ChatComposer>
	);
});

export function ChatView(props: ChatViewProps): JSX.Element {
	const { actions, model } = useChatViewModel();
	const participants = useBoundAgentParticipants();
	const runtimeIds = useActiveSessionRuntimeIds();
	const setHeaderRightSlot = useSetAtom(pageHeaderRightSlotAtom);
	const setHeaderLeftSlot = useSetAtom(pageHeaderLeftSlotAtom);
	const headerActions = useMemo(
		() => <ChatHeaderActionsView actions={actions} model={model.header} />,
		[actions, model.header],
	);
	const workspace = useMemo(
		() =>
			createActivityWorkspace(
				model.cwd ?? model.sessionId ?? "conversation:unbound",
				model.cwd,
				runtimeIds,
			),
		[model.cwd, model.sessionId, runtimeIds],
	);
	const onAbort = useCallback(() => {
		void props.onAbort();
	}, [props.onAbort]);

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
			workspace={workspace}
			rootClassName={model.rootClassName}
			exportState={model.exporting ? { title: model.exportTitle, onFinished: actions.finishExport } : undefined}
		>
			<SessionAssistantRendering>
				<SessionFeed
					messages={model.messages}
					workspace={workspace}
					isStreaming={model.isStreaming}
					pendingLabel={model.pendingLabel}
					sessionId={model.sessionId}
					participants={participants}
					onSend={props.onSend}
					onAbort={onAbort}
				/>
			</SessionAssistantRendering>
			<DefaultChatComposer {...props} />
		</DefaultChatView>
	);
}
