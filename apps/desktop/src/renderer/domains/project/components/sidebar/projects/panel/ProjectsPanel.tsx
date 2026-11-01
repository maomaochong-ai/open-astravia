import { ProjectsLoadingView } from "@astravia-org/theme-ui/project/ProjectsLoadingView";
import { ProjectsPanelView } from "@astravia-org/theme-ui/project/ProjectsPanelView";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DefaultConversationSection } from "./DefaultConversationSection";
import { ProjectGroupsSection } from "./ProjectGroupsSection";
import { ProjectsPanelEmptyState } from "./ProjectsPanelEmptyState";
import { ProjectsPanelMenus } from "./ProjectsPanelMenus";
import { useConversationTagsSync } from "../../../../hooks/useConversationTagsSync";
import { useProjectsPanelModel } from "./useProjectsPanelModel";
import type { ProjectsPanelProps } from "./types";

export function ProjectsPanel(props: ProjectsPanelProps): JSX.Element {
	const { t } = useTranslation("project");
	const model = useProjectsPanelModel(props);
	useConversationTagsSync();
	const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

	// User-added projects (and batch group under current filter). Default "对话" is separate.
	const hasUserProjects =
		model.filteredProjects.length > 0 || (model.showBatchGroup && model.batchProjects.length > 0);
	const showDefaultRegion = Boolean(model.defaultProject);
	// Full-panel empty only when neither region has content (rare: no default project either).
	const showEmpty = !hasUserProjects && !showDefaultRegion;
	// 没有用户项目时整个项目区隐藏，引导卡片改放在对话区下方。
	const showProjectsRegion = hasUserProjects;

	const defaultCwd = model.defaultProject?.cwd;
	const newConversation = (): void => {
		if (defaultCwd) model.actions.defaultNewSession(defaultCwd);
	};

	// 全新用户（没有任何项目、对话区也空着）才展示起步卡片。
	const showStartCard =
		!hasUserProjects &&
		!model.defaultSessionsLoading &&
		model.defaultSessions.length === 0 &&
		model.defaultConversationFilter === "conversation";

	const defaultSection =
		showDefaultRegion && model.defaultProject ? (
			<>
				<DefaultConversationSection
					activeSessionPath={model.activeSessionPath}
					activeTeamSessionId={model.activeTeamSessionId}
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
				{showStartCard && <ProjectsPanelEmptyState onNewConversation={newConversation} />}
			</>
		) : null;
	if (model.projectsLoading) return <ProjectsLoadingView />;

	return (
		<ProjectsPanelView
			defaultSection={defaultSection}
			emptyState={<ProjectsPanelEmptyState onNewConversation={newConversation} />}
			menus={<ProjectsPanelMenus model={model} />}
			onScrollRef={setScrollEl}
			scrollElement={scrollEl}
			projectsSection={
				hasUserProjects ? (
					<ProjectGroupsSection model={model} scrollParent={scrollEl} />
				) : null
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
