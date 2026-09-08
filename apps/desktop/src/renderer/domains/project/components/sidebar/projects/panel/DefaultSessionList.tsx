import type { DefaultConversationFilter } from "@shared/store/atoms";
import { DefaultSessionListView, DefaultSessionRowView } from "@vetta/theme-ui/project";
import { memo, useCallback } from "react";
import {
	type DefaultSessionListItemView,
	useDefaultSessionListModel,
} from "../../../../hooks/useDefaultSessionListModel";
import type { SidebarConversationInfo } from "../../../../services/sidebar-conversation-projection";

/**
 * 每行一个 memo 组件，per-row 回调在这里用 useCallback 固定住。
 * 直接在 renderSession 里现造 onSelect/onRename/onOpenContextMenu 的话，
 * 三个箭头函数每次渲染都换引用，下游 DefaultSessionRowView 的 memo 会全部落空。
 */
const DefaultSessionRow = memo(function DefaultSessionRow({
	item,
	contextMenuEnabled,
	onOpenContextMenu,
	onRename,
	onRenameDone,
	onSelect,
}: {
	item: DefaultSessionListItemView;
	contextMenuEnabled: boolean;
	onOpenContextMenu: (event: React.MouseEvent, session: SidebarConversationInfo) => void;
	onRename: (session: SidebarConversationInfo, name: string) => void;
	onRenameDone: () => void;
	onSelect: (session: SidebarConversationInfo) => void;
}): JSX.Element {
	const { session } = item;
	const handleContextMenu = useCallback(
		(event: React.MouseEvent) => onOpenContextMenu(event, session),
		[onOpenContextMenu, session],
	);
	const handleRename = useCallback((name: string) => onRename(session, name), [onRename, session]);
	const handleSelect = useCallback(() => onSelect(session), [onSelect, session]);

	return (
		<DefaultSessionRowView
			active={item.active}
			contextMenuEnabled={contextMenuEnabled}
			label={item.label}
			leadingAvatarUrls={item.leadingAvatarUrls}
			pinned={item.pinned}
			renaming={item.renaming}
			running={item.running}
			scheduled={item.scheduled}
			timeLabel={item.timeLabel}
			titleExtra={item.titleExtra}
			onOpenContextMenu={handleContextMenu}
			onRename={handleRename}
			onRenameDone={onRenameDone}
			onSelect={handleSelect}
		/>
	);
});

interface DefaultSessionListProps {
	activeSessionPath: string;
	activeTeamSessionId: string;
	className?: string;
	cwd: string;
	filter: DefaultConversationFilter;
	loading: boolean;
	onNewSession?: () => void;
	onRenameSession: (cwd: string, sessionPath: string, name: string) => void;
	onSelectSession: (cwd: string, session: SidebarConversationInfo) => void;
	scrollParent: HTMLElement | null;
	sessions: SidebarConversationInfo[];
}

export const DefaultSessionList = memo(function DefaultSessionList(
	props: DefaultSessionListProps,
): JSX.Element {
	const model = useDefaultSessionListModel(props);

	return (
		<DefaultSessionListView
			className={props.className}
			hasMore={model.hasMore}
			labels={model.labels}
			loading={props.loading}
			onEmptyAction={model.actions.emptyAction}
			onToggleShowAll={model.actions.toggleShowAll}
			scrollParent={props.scrollParent}
			sessions={model.sessions}
			showAll={model.showAll}
			totalCount={model.totalCount}
			visibleSessions={model.visibleSessions}
			renderSession={(item) => (
				<DefaultSessionRow
					key={item.key}
					item={item}
					contextMenuEnabled={model.contextMenuEnabled}
					onOpenContextMenu={model.actions.openContextMenu}
					onRename={model.actions.rename}
					onRenameDone={model.actions.renameDone}
					onSelect={model.actions.select}
				/>
			)}
		/>
	);
});
