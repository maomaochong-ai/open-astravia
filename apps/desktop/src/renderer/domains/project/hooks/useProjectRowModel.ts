import type { Project, ProjectType } from "@shared/store/atoms";
import type { ProjectRowViewProps } from "@vetta/theme-ui/project";

interface Args {
	badge?: string;
	displayName: string;
	expanded: boolean;
	hasRunning: boolean;
	isActive: boolean;
	onCollapse: (cwd: string) => void;
	onExpand: (cwd: string) => void;
	onNavigateProject: (cwd: string) => void;
	onNewSession: (cwd: string) => void;
	onOpenContextMenu: (event: React.MouseEvent, project: Project) => void;
	newSessionTitle: string;
	project: Project;
	projectType: ProjectType;
}

export function useProjectRowModel({
	badge,
	displayName,
	expanded,
	hasRunning,
	isActive,
	onCollapse,
	onExpand,
	onNavigateProject,
	onNewSession,
	onOpenContextMenu,
	newSessionTitle,
	project,
	projectType,
}: Args): ProjectRowViewProps {
	return {
		badge,
		displayName,
		expanded,
		hasRunning,
		isActive,
		newSessionTitle,
		projectCwd: project.cwd,
		projectType,
		onCollapse: () => onCollapse(project.cwd),
		onExpand: () => onExpand(project.cwd),
		onNavigateProject: () => onNavigateProject(project.cwd),
		onNewSession: () => onNewSession(project.cwd),
		onOpenContextMenu: (event) => onOpenContextMenu(event, project),
	};
}
