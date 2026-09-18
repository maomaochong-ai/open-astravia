import { useChatSurfaceActive } from "@shared/chat-surface-active";
import { useOwnedHeaderSlot } from "@shared/hooks/useOwnedHeaderSlot";
import { pageHeaderLeftSlotAtom, pageHeaderRightSlotAtom } from "@shared/store/atoms";
import { useActiveSessionRuntimeIds } from "@shared/workspace/active-session-runtime";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import { useSetAtom } from "jotai";
import { memo, useCallback, useMemo } from "react";
import { useBoundAgentParticipants } from "../hooks/useBoundAgentParticipants";
import { useChatViewModel } from "../hooks/useChatViewModel";
import { ChatHeaderActionsView } from "./chat-view/ChatHeaderActionsView";
import { ChatHeaderNewSessionButton } from "./chat-view/ChatHeaderNewSessionButton";
import { DefaultChatView, ChatComposer, EMPTY_CHAT_MESSAGES } from "./chat-view/DefaultChatView";
import { SessionMessageList } from "./SessionMessageList";
import { SessionAssistantRendering } from "./SessionAssistantRendering";
import { DefaultInputBarConnector } from "./input-bar/DefaultInputBarConnector";
import type { ChatViewProps } from "./chat-view/types";

const FrozenSessionFeed = memo(SessionMessageList);

export function ChatView(props: ChatViewProps): JSX.Element {
	const { actions, model } = useChatViewModel();
	const participants = useBoundAgentParticipants();
	const runtimeIds = useActiveSessionRuntimeIds();
	const setHeaderRightSlot = useSetAtom(pageHeaderRightSlotAtom);
	const setHeaderLeftSlot = useSetAtom(pageHeaderLeftSlotAtom);
	const chatSurfaceActive = useChatSurfaceActive();
	const headerActions = useMemo(
		() => <ChatHeaderActionsView actions={actions} model={model.header} />,
		[actions, model.header],
	);
	const headerLeft = useMemo(() => <ChatHeaderNewSessionButton />, []);
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

	const writeHeaderRight = useCallback(
		(slot: typeof headerActions | null) => {
			setHeaderRightSlot(slot);
		},
		[setHeaderRightSlot],
	);
	const writeHeaderLeft = useCallback(
		(slot: typeof headerLeft | null) => {
			setHeaderLeftSlot(slot);
		},
		[setHeaderLeftSlot],
	);

	useOwnedHeaderSlot(chatSurfaceActive, headerActions, writeHeaderRight);
	useOwnedHeaderSlot(chatSurfaceActive, headerLeft, writeHeaderLeft);

	return (
		<SessionAssistantRendering>
			<DefaultChatView
				messages={model.exporting ? model.messages : EMPTY_CHAT_MESSAGES}
				workspace={workspace}
				rootClassName={model.rootClassName}
				exportState={model.exporting ? { title: model.exportTitle, onFinished: actions.finishExport } : undefined}
			>
				<FrozenSessionFeed
					messages={model.messages}
					workspace={workspace}
					isStreaming={model.isStreaming}
					sessionId={model.sessionId}
					participants={participants}
					onSend={props.onSend}
					onAbort={onAbort}
				/>
				<ChatComposer>
					<DefaultInputBarConnector
						onSend={props.onSend}
						onAbort={props.onAbort}
						onSendQueued={props.onSendQueued}
						cwdOverride={props.cwdOverride}
					/>
				</ChatComposer>
			</DefaultChatView>
		</SessionAssistantRendering>
	);
}
