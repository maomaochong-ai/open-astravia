import type { DefaultConversationFilter, SessionInfo } from "@shared/store/atoms";
import { DefaultSessionListView, DefaultSessionRowView } from "@vetta/theme-ui/project";
import { memo, useCallback } from "react";
import {
	type DefaultSessionListItemView,
	useDefaultSessionListModel,
} from "../../../../hooks/useDefaultSessionListModel";

/**
 * 每行一个 memo 组件，per-row 回调在这里用 useCallback 固定住。
 * 直接在 renderSession 里现造 onSelect/onRename/onOpenContextMenu 的话，
 * 三个箭头函数每次渲染都换引用，下游 DefaultSessionRowView 的 memo 会全部落空。
 */
const DefaultSessionRow = memo(function DefaultSessionRow({
	item,
	contextMenuEnabled,
	onBeforeSelect,
	onOpenContextMenu,
	onRename,
	onRenameDone,
	onSelect,
}: {
	item: DefaultSessionListItemView;
	contextMenuEnabled: boolean;
	onBeforeSelect: () => void;
	onOpenContextMenu: (event: React.MouseEvent, session: SessionInfo) => void;
	onRename: (sessionPath: string, name: string) => void;
	onRenameDone: () => void;
	onSelect: (sessionPath: string) => void;
}): JSX.Element {
	const { path, session } = item;
	const handleContextMenu = useCallback(
		(event: React.MouseEvent) => onOpenContextMenu(event, session),
		[onOpenContextMenu, session],
	);
	const handleRename = useCallback((name: string) => onRename(path, name), [onRename, path]);
	const handleSelect = useCallback(() => onSelect(path), [onSelect, path]);

	return (
		<DefaultSessionRowView
			active={item.active}
			contextMenuEnabled={contextMenuEnabled}
			label={item.label}
			onBeforeSelect={onBeforeSelect}
			renaming={item.renaming}
			running={item.running}
			scheduled={item.scheduled}
			timeLabel={item.timeLabel}
			onOpenContextMenu={handleContextMenu}
			onRename={handleRename}
			onRenameDone={onRenameDone}
			onSelect={handleSelect}
		/>
	);
});

interface DefaultSessionListProps {
	activeSessionPath: string;
	className?: string;
	cwd: string;
	filter: DefaultConversationFilter;
	loading: boolean;
	onBeforeSelect: () => void;
	onNewSession?: () => void;
	onRenameSession: (cwd: string, sessionPath: string, name: string) => void;
	onSelectSession: (cwd: string, sessionPath: string) => void;
	scrollParent: HTMLElement | null;
	sessions: SessionInfo[];
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
					onBeforeSelect={props.onBeforeSelect}
					onOpenContextMenu={model.actions.openContextMenu}
					onRename={model.actions.rename}
					onRenameDone={model.actions.renameDone}
					onSelect={model.actions.select}
				/>
			)}
		/>
	);
});
