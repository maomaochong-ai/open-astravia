import { ProjectsLoadingView, ProjectsPanelView } from "@vetta/theme-ui/project";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DefaultConversationSection } from "./DefaultConversationSection";
import { ProjectGroupsSection } from "./ProjectGroupsSection";
import { ProjectsPanelEmptyState } from "./ProjectsPanelEmptyState";
import { ProjectsPanelMenus } from "./ProjectsPanelMenus";
import { useProjectsPanelModel } from "./useProjectsPanelModel";
import type { ProjectsPanelProps } from "./types";

export function ProjectsPanel(props: ProjectsPanelProps): JSX.Element {
	const { t } = useTranslation("project");
	const model = useProjectsPanelModel(props);
	const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

	// User-added projects (and batch group under current filter). Default "对话" is separate.
	const hasUserProjects =
		model.filteredProjects.length > 0 || (model.showBatchGroup && model.batchProjects.length > 0);
	const showDefaultRegion = Boolean(model.defaultProject);
	// Full-panel empty only when neither region has content (rare: no default project either).
	const showEmpty = !hasUserProjects && !showDefaultRegion;
	// When default conversation exists but no user projects, still show the empty
	// placeholder in the projects region (noOtherProjects was already computed for this).
	const showProjectsEmpty = model.noOtherProjects && showDefaultRegion;
	const showProjectsRegion = hasUserProjects || showProjectsEmpty;

	const defaultSection =
		showDefaultRegion && model.defaultProject ? (
			<DefaultConversationSection
				activeSessionPath={model.activeSessionPath}
				defaultConversationFilter={model.defaultConversationFilter}
				listClassName={props.defaultSessionListClassName}
				project={model.defaultProject}
				scrollParent={scrollEl}
				sessionsCwd={model.defaultSessionsCwd}
				sessions={model.defaultSessions}
				sessionsLoading={model.defaultSessionsLoading}
				onNewSession={model.actions.defaultNewSession}
				onRenameSession={model.actions.renameSession}
				onSelectSession={model.actions.defaultSelectSession}
			/>
		) : null;
	if (model.projectsLoading) return <ProjectsLoadingView />;

	return (
		<ProjectsPanelView
			defaultSection={defaultSection}
			emptyState={<ProjectsPanelEmptyState />}
			menus={<ProjectsPanelMenus model={model} />}
			onScrollRef={setScrollEl}
			scrollElement={scrollEl}
			projectsSection={
				hasUserProjects ? (
					<ProjectGroupsSection model={model} scrollParent={scrollEl} />
				) : (
					<ProjectsPanelEmptyState />
				)
			}
			quickScrollLabels={{
				bottom: t("sidebar.projects.scrollToBottom"),
				top: t("sidebar.projects.scrollToTop"),
			}}
			showDefaultRegion={showDefaultRegion}
			showEmpty={showEmpty}
			showProjectsRegion={showProjectsRegion}
		/>
	);
}
