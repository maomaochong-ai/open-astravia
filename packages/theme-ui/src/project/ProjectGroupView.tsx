import { useRef, type JSX, type ReactNode } from "react";
import { ProjectRowView, type ProjectRowViewProps } from "./ProjectRowView";
import { ProjectSessionsView, type ProjectSessionsViewProps } from "./ProjectSessionsView";
import {
	prepareSidebarSelection,
	useExpandedProjectAutoScroll,
} from "./useActiveSessionAutoScroll";

export interface ProjectGroupViewProps<T extends { key: string }> {
	onProjectInteract: () => void;
	projectRow: ProjectRowViewProps;
	sessions: Omit<ProjectSessionsViewProps<T>, "empty">;
	/** Empty sessions label node. */
	emptySessions: ReactNode;
}

export function ProjectGroupView<T extends { key: string }>({
	onProjectInteract,
	projectRow,
	sessions,
	emptySessions,
}: ProjectGroupViewProps<T>): JSX.Element {
	const projectRowRef = useRef<HTMLDivElement>(null);
	useExpandedProjectAutoScroll({
		expanded: projectRow.expanded,
		projectRowRef,
		scrollParent: sessions.scrollParent,
	});
	const handleProjectInteract = (): void => {
		onProjectInteract();
		if (projectRowRef.current) prepareSidebarSelection(projectRowRef.current);
	};

	return (
		<div className="project-group-contain mb-1">
			<ProjectRowView {...projectRow} onInteract={handleProjectInteract} rowRef={projectRowRef} />
			<ProjectSessionsView {...sessions} empty={emptySessions} />
		</div>
	);
}
