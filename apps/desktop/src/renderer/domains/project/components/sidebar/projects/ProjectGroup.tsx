import type { Project } from "@shared/store/atoms";
import { ProjectGroupView, SessionRowView } from "@vetta/theme-ui/project";
import { memo, useCallback } from "react";
import {
	type ProjectGroupSessionView,
	useProjectGroupModel,
} from "../../../hooks/useProjectGroupModel";
import type { SidebarConversationInfo } from "../../../services/sidebar-conversation-projection";

/** 每行一个 memo 组件，per-row 回调在这里固定引用（理由同 DefaultSessionRow）。 */
const ProjectSessionRow = memo(function ProjectSessionRow({
	item,
	onOpenContextMenu,
	onRename,
	onRenameDone,
	onSelect,
}: {
	item: ProjectGroupSessionView;
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
		<SessionRowView
			active={item.active}
			iconClassName={item.iconClassName}
			label={item.label}
			pinned={item.pinned}
			renaming={item.renaming}
			running={item.running}
			scheduled={item.scheduled}
			trailingAvatarUrls={item.trailingAvatarUrls}
			titleExtra={item.titleExtra}
			onOpenContextMenu={handleContextMenu}
			onRename={handleRename}
			onRenameDone={onRenameDone}
			onSelect={handleSelect}
		/>
	);
});

interface ProjectGroupProps {
	project: Project;
	scrollParent: HTMLElement | null;
	sessions: SidebarConversationInfo[];
	sessionsLoading: boolean;
	isExpanded: boolean;
	isActive?: boolean;
	activeSessionPath: string;
	activeTeamSessionId: string;
	onExpand: (cwd: string) => void;
	onCollapse: (cwd: string) => void;
	onNavigateProject: (cwd: string) => void;
	onNewSession: (cwd: string) => void;
	onSelectSession: (cwd: string, session: SidebarConversationInfo) => void;
	onRenameSession: (cwd: string, sessionPath: string, name: string) => void;
}

export const ProjectGroup = memo(function ProjectGroup(props: ProjectGroupProps): JSX.Element {
	const model = useProjectGroupModel(props);

	return (
		<ProjectGroupView
			projectRow={{
				badge: model.projectBadge,
				displayName: model.displayName,
				expanded: model.expanded,
				hasRunning: model.hasRunning,
				isActive: model.isActive,
				newSessionTitle: model.newSessionTitle,
				onCollapse: model.actions.collapse,
				onExpand: model.actions.expand,
				onNavigateProject: model.actions.navigateProject,
				onNewSession: model.actions.newSession,
				onOpenContextMenu: model.actions.openProjectContextMenu,
				projectCwd: model.project.cwd,
				projectType: model.projectType,
			}}
			emptySessions={
				<p className="px-2.5 py-1.5 pl-[36px] text-[12px] text-muted-foreground">
					{model.noSessionsLabel}
				</p>
			}
			sessions={{
				expanded: model.expanded,
				hasMore: model.hasMoreSessions,
				loading: props.sessionsLoading,
				labels: model.showMoreLabels,
				onToggleShowAll: model.actions.toggleShowAll,
				scrollParent: props.scrollParent,
				sessions: model.sessionViews,
				showAll: model.showAllSessions,
				renderSession: (session) => (
					<ProjectSessionRow
						key={session.key}
						item={session}
						onOpenContextMenu={model.actions.openSessionContextMenu}
						onRename={model.actions.renameSession}
						onRenameDone={model.actions.renameDone}
						onSelect={model.actions.selectSession}
					/>
				),
			}}
		/>
	);
});
