import type { Project, ProjectType } from "@shared/store/atoms";
import { isSshProjectUri } from "@vetta/ssh-transport/project-uri";
import type { ProjectRowViewProps } from "@vetta-org/theme-ui/project";

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
		remote: isSshProjectUri(project.cwd),
		onCollapse: () => onCollapse(project.cwd),
		onExpand: () => onExpand(project.cwd),
		onNavigateProject: () => onNavigateProject(project.cwd),
		onNewSession: () => onNewSession(project.cwd),
		onOpenContextMenu: (event) => onOpenContextMenu(event, project),
	};
}
