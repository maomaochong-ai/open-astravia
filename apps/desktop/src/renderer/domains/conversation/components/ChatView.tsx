import { useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { pageHeaderLeftSlotAtom, pageHeaderRightSlotAtom } from "@shared/store/atoms";
import { useActiveSessionRuntimeIds } from "@shared/workspace/active-session-runtime";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { WorkSurfaceScope } from "@shared/workspace/work-surface";
import { useBoundAgentParticipants } from "../hooks/useBoundAgentParticipants";
import { useChatViewModel } from "../hooks/useChatViewModel";
import { useWindowPinAction } from "../hooks/useWindowPinAction";
import { useBottomPanelToggle } from "@domains/bottom-panel/hooks/useBottomPanelToggle";
import { useOpenTerminal } from "@domains/bottom-panel/hooks/useOpenTerminal";
import { ChatHeaderActions } from "@vetta-org/theme-ui/chat";
import { BackgroundTasksBadge } from "./BackgroundTasksBadge";
import { SandboxGrantsBadge } from "./SandboxGrantsBadge";
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
	workSurface,
}: ChatViewProps & { readonly workSurface?: WorkSurfaceScope | null }): JSX.Element {
	return (
		<ChatComposer>
			<DefaultInputBarConnector
				onSend={onSend}
				onAbort={onAbort}
				onSendQueued={onSendQueued}
				cwdOverride={cwdOverride}
				workSurface={workSurface}
			/>
		</ChatComposer>
	);
});

export function ChatView(props: ChatViewProps): JSX.Element {
	const { t } = useTranslation("chat");
	const { actions, model } = useChatViewModel();
	const participants = useBoundAgentParticipants();
	const runtimeIds = useActiveSessionRuntimeIds();
	const pin = useWindowPinAction();
	const terminal = useOpenTerminal(model.workSurface);
	const bottomPanel = useBottomPanelToggle(model.workSurface);
	const setHeaderRightSlot = useSetAtom(pageHeaderRightSlotAtom);
	const setHeaderLeftSlot = useSetAtom(pageHeaderLeftSlotAtom);
	const workspace = useMemo(
		() =>
			createActivityWorkspace(
				model.cwd ?? model.sessionId ?? "conversation:unbound",
				model.cwd,
				runtimeIds,
			),
		[model.cwd, model.sessionId, runtimeIds],
	);
	const headerActions = useMemo(
		() => (
			<>
				<BackgroundTasksBadge runtimeIds={runtimeIds} activityWorkspaceId={workspace.id} />
				<SandboxGrantsBadge runtimeIds={runtimeIds} />
				<ChatHeaderActions.Export
					title={model.header.exportTitle}
					disabled={model.header.exportDisabled}
					exporting={model.header.exporting}
					onClick={actions.openExport}
				/>
				<ChatHeaderActions.Pin
					title={pin.pinned ? t("chatView.pinButton.pinned") : t("chatView.pinButton.unpinned")}
					pinned={pin.pinned}
					onClick={pin.toggle}
				/>
				<ChatHeaderActions.Terminal
					title={
						!terminal.available
							? t("chatView.terminalButton.unavailable")
							: terminal.focused
								? t("chatView.terminalButton.focused")
								: t("chatView.terminalButton.open")
					}
					focused={terminal.focused}
					disabled={!terminal.available}
					onClick={terminal.open}
				/>
				<ChatHeaderActions.BottomPanel
					title={
						bottomPanel.open
							? t("chatView.bottomPanelButton.open")
							: t("chatView.bottomPanelButton.closed")
					}
					open={bottomPanel.open}
					onClick={bottomPanel.toggle}
				/>
				<ChatHeaderActions.Panel
					title={model.header.panelTitle}
					open={model.header.panelOpen}
					onClick={actions.togglePanel}
				/>
			</>
		),
		[actions, bottomPanel, model.header, pin, runtimeIds, t, terminal, workspace.id],
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
			workSurface={model.workSurface}
			rootClassName={model.rootClassName}
			exportState={
				model.exporting
					? { title: model.exportTitle, participants, onFinished: actions.finishExport }
					: undefined
			}
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
			<DefaultChatComposer {...props} workSurface={model.workSurface} />
		</DefaultChatView>
	);
}
