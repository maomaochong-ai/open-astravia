import { useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { pageHeaderLeftSlotAtom, pageHeaderRightSlotAtom } from "@shared/store/atoms";
import { usePageHeaderUtilitySlot } from "@shared/app-shell/page-header/usePageHeaderUtilitySlot";
import { useActiveSessionRuntimeIds } from "@shared/workspace/active-session-runtime";
import { createConversationActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { WorkSurfaceScope } from "@shared/workspace/work-surface";
import { useBoundAgentParticipants } from "../hooks/useBoundAgentParticipants";
import { useChatViewModel } from "../hooks/useChatViewModel";
import { useWindowPinAction } from "../hooks/useWindowPinAction";
import { useBottomPanelToggle } from "@domains/bottom-panel/hooks/useBottomPanelToggle";
import { useOpenTerminal } from "@domains/bottom-panel/hooks/useOpenTerminal";
import { HeaderActionGroup } from "@astravia-org/theme-ui/chat/HeaderActionGroupView";
import { type HeaderActionItem } from "@astravia-org/theme-ui/chat/HeaderActionGroupView";
import { useHeaderActionPreference } from "../hooks/useHeaderActionPreference";
import { BackgroundTasksBadge } from "./BackgroundTasksBadge";
import { SandboxGrantsBadge } from "./SandboxGrantsBadge";
import { OpenWorkspaceWithAppButton } from "@domains/file-explorer/components/OpenWorkspaceWithAppButton";
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
	const setHeaderLeftSlot = useSetAtom(pageHeaderLeftSlotAtom);
	const workspace = useMemo(
		() => createConversationActivityWorkspace(model.cwd, model.sessionId, runtimeIds),
		[model.cwd, model.sessionId, runtimeIds],
	);
	// 顶栏动作：顺序与显示交给用户（本地保存），「调整」模式可拖动排序、点击隐藏。
	const headerActionItems = useMemo<readonly HeaderActionItem[]>(
		() => [
			{
				id: "export",
				title: model.header.exportTitle,
				icon: "icon-[solar--square-share-line-linear]",
				disabled: model.header.exportDisabled,
				onClick: actions.openExport,
				priority: 3,
			},
			{
				id: "pin",
				title: pin.pinned ? t("chatView.pinButton.pinned") : t("chatView.pinButton.unpinned"),
				icon: "icon-[solar--pin-linear]",
				active: pin.pinned,
				onClick: pin.toggle,
				priority: 1,
			},
			{
				id: "terminal",
				title: !terminal.available
					? t("chatView.terminalButton.unavailable")
					: terminal.focused
						? t("chatView.terminalButton.focused")
						: t("chatView.terminalButton.open"),
				icon: "icon-[solar--programming-linear]",
				active: terminal.focused,
				disabled: !terminal.available,
				onClick: terminal.open,
				priority: 2,
			},
			{
				id: "bottom-panel",
				title: bottomPanel.open
					? t("chatView.bottomPanelButton.open")
					: t("chatView.bottomPanelButton.closed"),
				icon: "icon-[solar--window-frame-linear]",
				active: bottomPanel.open,
				onClick: bottomPanel.toggle,
				priority: 2,
			},
			{
				id: "activity-panel",
				title: model.header.panelTitle,
				icon: "icon-[solar--sidebar-minimalistic-linear]",
				active: model.header.panelOpen,
				onClick: actions.togglePanel,
				priority: 5,
			},
		],
		[actions, bottomPanel, model.header, pin, t, terminal],
	);
	const headerPreference = useHeaderActionPreference(headerActionItems);

	const headerActions = useMemo(
		() => (
			<>
				<BackgroundTasksBadge runtimeIds={runtimeIds} activityWorkspaceId={workspace.id} />
				<SandboxGrantsBadge runtimeIds={runtimeIds} />
				{/*
				 * 动作收进一个按钮组：窗口变窄时由 HeaderActionGroup 决定放得下几个，
				 * 其余收进「更多」菜单；「调整」模式可拖动排序并按需隐藏。
				 */}
				<HeaderActionGroup
					labels={{ more: t("chatView.headerActions.more"), edit: t("chatView.headerActions.edit") }}
					items={headerPreference.items}
					editing={headerPreference.editing}
					hiddenIds={headerPreference.hiddenIds}
					onReorder={headerPreference.reorder}
					onToggleVisibility={headerPreference.toggleVisibility}
					extraActions={[
						{
							id: "__adjust",
							title: t("chatView.headerActions.edit"),
							icon: "icon-[solar--sort-from-top-to-bottom-linear]",
							active: headerPreference.editing,
							onClick: () => headerPreference.setEditing(!headerPreference.editing),
						},
					]}
				/>
			</>
		),
		[actions, bottomPanel, headerPreference, model.header, pin, runtimeIds, t, terminal, workspace.id],
	);
	const onAbort = useCallback(() => {
		void props.onAbort();
	}, [props.onAbort]);

	useEffect(() => {
		setHeaderRightSlot(headerActions);
		return () => setHeaderRightSlot(null);
	}, [headerActions, setHeaderRightSlot]);

	// 「在外部应用中打开工作区」占顶栏工具位，渲染在页面自身动作（导出、置顶等）的左侧。
	const workspaceAppButton = useMemo(() => <OpenWorkspaceWithAppButton rootDir={model.cwd} />, [model.cwd]);
	// 优先级 0：对话页自己的工作区最相关；活动面板的文件标签作为低优先级备选。
	usePageHeaderUtilitySlot("conversation", 0, workspaceAppButton);

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
