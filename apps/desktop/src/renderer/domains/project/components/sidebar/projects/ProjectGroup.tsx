import type { Project, SessionInfo } from "@shared/store/atoms";
import { ProjectGroupView, SessionRowView } from "@vetta/theme-ui/project";
import { memo, useCallback } from "react";
import {
	type ProjectGroupSessionView,
	useProjectGroupModel,
} from "../../../hooks/useProjectGroupModel";

/** 每行一个 memo 组件，per-row 回调在这里固定引用（理由同 DefaultSessionRow）。 */
const ProjectSessionRow = memo(function ProjectSessionRow({
	item,
	onBeforeSelect,
	onOpenContextMenu,
	onRename,
	onRenameDone,
	onSelect,
}: {
	item: ProjectGroupSessionView;
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
		<SessionRowView
			active={item.active}
			label={item.label}
			renaming={item.renaming}
			running={item.running}
			scheduled={item.scheduled}
			timeLabel={item.timeLabel}
			onBeforeSelect={onBeforeSelect}
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
	sessions: SessionInfo[];
	sessionsLoading: boolean;
	isExpanded: boolean;
	isActive?: boolean;
	activeSessionPath: string;
	onExpand: (cwd: string) => void;
	onCollapse: (cwd: string) => void;
	onNavigateProject: (cwd: string) => void;
	onNewSession: (cwd: string) => void;
	onProjectInteract: () => void;
	onSelectSession: (cwd: string, sessionPath: string) => void;
	onRenameSession: (cwd: string, sessionPath: string, name: string) => void;
}

export const ProjectGroup = memo(function ProjectGroup(props: ProjectGroupProps): JSX.Element {
	const model = useProjectGroupModel(props);

	return (
		<ProjectGroupView
			onProjectInteract={props.onProjectInteract}
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
						onBeforeSelect={props.onProjectInteract}
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
