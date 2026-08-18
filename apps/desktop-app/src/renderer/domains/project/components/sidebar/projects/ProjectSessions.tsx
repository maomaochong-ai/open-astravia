import type { SessionInfo } from "@shared/store/atoms";
import { ProjectSessionsView } from "@vetta/theme-ui/project";
import { useProjectSessionsModel } from "../../../hooks/useProjectSessionsModel";

interface ProjectSessionsProps {
	children: (session: SessionInfo) => JSX.Element;
	expanded: boolean;
	hasMore: boolean;
	hiddenCount: number;
	onToggleShowAll: () => void;
	renderEmpty: () => JSX.Element;
	scrollParent: HTMLElement | null;
	sessions: SessionInfo[];
	showAll: boolean;
}

export function ProjectSessions({
	children,
	expanded,
	hasMore,
	hiddenCount,
	onToggleShowAll,
	renderEmpty,
	scrollParent,
	sessions,
	showAll,
}: ProjectSessionsProps): JSX.Element {
	const model = useProjectSessionsModel({ hasMore, hiddenCount, showAll });
	const items = sessions.map((session) => ({ key: session.path, session }));

	return (
		<ProjectSessionsView
			empty={renderEmpty()}
			expanded={expanded}
			hasMore={model.hasMore}
			labels={model.labels}
			onToggleShowAll={onToggleShowAll}
			scrollParent={scrollParent}
			sessions={items}
			showAll={model.showAll}
			renderSession={(item) => children(item.session)}
		/>
	);
}
