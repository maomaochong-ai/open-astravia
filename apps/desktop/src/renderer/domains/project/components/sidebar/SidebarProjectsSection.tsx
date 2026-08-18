import type { SessionExecutionMode, SidebarFilter } from "@shared/store/atoms";
import { SidebarProjectsSectionView } from "@vetta/theme-ui/project";
import { AddProjectMenu } from "./add-project/AddProjectMenu";
import { SidebarFilterSelect } from "./filters/SidebarFilterSelect";
import { ProjectsPanel } from "./projects/panel/ProjectsPanel";
import { useSidebarProjectsSectionModel } from "../../hooks/useSidebarProjectsSectionModel";

interface SidebarProjectsSectionProps {
	className?: string;
	classNames?: {
		list?: string;
		toolbar?: string;
	};
	filter: SidebarFilter;
	onOpenSession: (
		cwd: string,
		sessionPath?: string,
		executionMode?: SessionExecutionMode,
	) => Promise<void>;
}

export function SidebarProjectsSection(props: SidebarProjectsSectionProps): JSX.Element {
	const model = useSidebarProjectsSectionModel(props);
	return (
		<SidebarProjectsSectionView
			className={props.className}
			classNames={props.classNames}
			filterSelect={<SidebarFilterSelect />}
			addProjectMenu={<AddProjectMenu />}
			panel={
				<ProjectsPanel
					defaultSessionListClassName={props.classNames?.list}
					filter={props.filter}
					onOpenSession={props.onOpenSession}
				/>
			}
			{...model}
		/>
	);
}
