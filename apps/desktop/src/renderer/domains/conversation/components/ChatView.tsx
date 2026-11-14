import { useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
	pageHeaderImmersiveAtom,
	pageHeaderLeftActionsAtom,
	pageHeaderRightSlotAtom,
} from "@shared/store/atoms";
import { useActiveSessionRuntimeIds } from "@shared/workspace/active-session-runtime";
import { createConversationActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { WorkSurfaceScope } from "@shared/workspace/work-surface";
import { useBoundAgentParticipants } from "../hooks/useBoundAgentParticipants";
import { useChatViewModel } from "../hooks/useChatViewModel";
import { useWindowPinAction } from "../hooks/useWindowPinAction";
import { useBottomPanelToggle } from "@domains/bottom-panel/hooks/useBottomPanelToggle";
import { useOpenTerminal } from "@domains/bottom-panel/hooks/useOpenTerminal";
import { ChatHeaderActions } from "@astravia-org/theme-ui/chat";
import type { HeaderActionBarItem } from "@astravia-org/theme-ui/chat";
import { ConversationHeaderActions } from "@domains/header-actions/ConversationHeaderActions";
import { BackgroundTasksBadge } from "./BackgroundTasksBadge";
import { SandboxGrantsBadge } from "./SandboxGrantsBadge";
import { ChatHeaderNewSessionButton } from "./chat-view/ChatHeaderNewSessionButton";
import { DefaultChatView, ChatComposer } from "./chat-view/DefaultChatView";
import { SessionConversation } from "../session-conversation/SessionConversation";
import { DefaultInputBarConnector } from "./input-bar/DefaultInputBarConnector";
import type { ChatViewProps } from "./chat-view/types";

const SessionFeed = memo(SessionConversation);

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
				contentWidth="message"
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
	const setHeaderImmersive = useSetAtom(pageHeaderImmersiveAtom);
	const setHeaderLeftActions = useSetAtom(pageHeaderLeftActionsAtom);
	const workspace = useMemo(
		() => createConversationActivityWorkspace(model.cwd, model.sessionId, runtimeIds),
		[model.cwd, model.sessionId, runtimeIds],
	);
	// 内置动作与插件动作同属一个按钮组（顶栏最多 7 格，可收纳、可拖动）；这里只给数据，渲染与布局在宿主按钮组里。
	const builtinHeaderActions = useMemo<HeaderActionBarItem[]>(
		() => [
			{
				key: "builtin:export",
				title: model.header.exportTitle,
				disabled: model.header.exportDisabled,
				icon: (
					<span
						className={
							model.exporting ? "icon-[mdi--loading] animate-spin" : "icon-[solar--square-share-line-linear]"
						}
					/>
				),
				behavior: { type: "click", onClick: actions.openExport },
			},
			{
				key: "builtin:pin",
				title: pin.pinned ? t("chatView.pinButton.pinned") : t("chatView.pinButton.unpinned"),
				active: pin.pinned,
				// 窗口置顶开着时，即使被收纳也要在面板开关旁露出来，否则用户找不到取消的入口。
				promoteWhenActive: true,
				// 顶栏被挤窄、其余按钮收进「更多」时，置顶仍留在活动面板开关旁边。
				retainWhenNarrow: true,
				icon: <span className={pin.pinned ? "icon-[solar--pin-bold]" : "icon-[solar--pin-linear]"} />,
				behavior: { type: "click", onClick: pin.toggle },
			},
			{
				key: "builtin:terminal",
				title: !terminal.available
					? t("chatView.terminalButton.unavailable")
					: terminal.focused
						? t("chatView.terminalButton.focused")
						: t("chatView.terminalButton.open"),
				active: terminal.focused,
				disabled: !terminal.available,
				icon: <span className="icon-[solar--programming-linear]" />,
				behavior: { type: "click", onClick: terminal.open },
			},
			{
				key: "builtin:bottom-panel",
				title: bottomPanel.open
					? t("chatView.bottomPanelButton.open")
					: t("chatView.bottomPanelButton.closed"),
				active: bottomPanel.open,
				icon: <span className="icon-[solar--window-frame-linear]" />,
				behavior: { type: "click", onClick: bottomPanel.toggle },
			},
		],
		[actions.openExport, bottomPanel, model.exporting, model.header, pin, t, terminal],
	);
	const headerActions = useMemo(
		() => (
			<>
				<BackgroundTasksBadge runtimeIds={runtimeIds} activityWorkspaceId={workspace.id} />
				<SandboxGrantsBadge runtimeIds={runtimeIds} />
				<ConversationHeaderActions
					builtins={builtinHeaderActions}
					pinned={
						<ChatHeaderActions.Panel
							title={model.header.panelTitle}
							open={model.header.panelOpen}
							onClick={actions.togglePanel}
						/>
					}
				/>
			</>
		),
		[
			actions.togglePanel,
			builtinHeaderActions,
			model.header.panelOpen,
			model.header.panelTitle,
			runtimeIds,
			workspace.id,
		],
	);
	const onAbort = useCallback(() => {
		void props.onAbort();
	}, [props.onAbort]);

	useEffect(() => {
		setHeaderRightSlot(headerActions);
		return () => setHeaderRightSlot(null);
	}, [headerActions, setHeaderRightSlot]);

	// 沉浸式顶栏：消息流滚到顶栏下面，顶部留白与滚动渐隐由 MessageFeedLayoutVirtualizer 负责。
	useEffect(() => {
		setHeaderImmersive(true);
		return () => setHeaderImmersive(false);
	}, [setHeaderImmersive]);

	// 新会话与「展开侧边栏」并进同一颗胶囊：侧边栏不可见时两者总是同时出现。
	useEffect(() => {
		setHeaderLeftActions(<ChatHeaderNewSessionButton />);
		return () => setHeaderLeftActions(null);
	}, [setHeaderLeftActions]);

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
			<SessionFeed
				workspace={workspace}
				pendingLabel={model.pendingLabel}
				sessionId={model.sessionId}
				participants={participants}
				onSend={props.onSend}
				onAbort={onAbort}
			/>
			<DefaultChatComposer {...props} workSurface={model.workSurface} />
		</DefaultChatView>
	);
}
