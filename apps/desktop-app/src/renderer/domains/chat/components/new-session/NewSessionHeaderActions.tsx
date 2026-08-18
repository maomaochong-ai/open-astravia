import { ChatHeaderActionsView } from "@vetta/theme-ui/chat";

interface NewSessionHeaderActionsProps {
	activityOpen: boolean;
	onToggleActivity: () => void;
	onTogglePin: () => void;
	panelTitle: string;
	pinTitle: string;
	pinned: boolean;
}

/**
 * 新会话页的标题栏右侧动作：保留窗口置顶与活动面板开关。
 * 此时还没有消息，因此不渲染导出按钮。
 */
export function NewSessionHeaderActions({
	activityOpen,
	onToggleActivity,
	onTogglePin,
	panelTitle,
	pinTitle,
	pinned,
}: NewSessionHeaderActionsProps): JSX.Element {
	return (
		<ChatHeaderActionsView
			badges={null}
			pinTitle={pinTitle}
			pinned={pinned}
			onTogglePin={onTogglePin}
			panelTitle={panelTitle}
			panelOpen={activityOpen}
			onTogglePanel={onToggleActivity}
		/>
	);
}
