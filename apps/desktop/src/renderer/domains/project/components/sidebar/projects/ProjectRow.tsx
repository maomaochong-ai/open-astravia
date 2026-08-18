import type { Project, ProjectType } from "@shared/store/atoms";
import { ProjectRowView } from "@vetta/theme-ui/project";
import { useProjectRowModel } from "../../../hooks/useProjectRowModel";

interface ProjectRowProps {
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

export function ProjectRow(props: ProjectRowProps): JSX.Element {
	const model = useProjectRowModel(props);
	return <ProjectRowView {...model} />;
}
