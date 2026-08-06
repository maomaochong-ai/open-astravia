import {
	clampSidebarProjectsSplitRatio,
	SIDEBAR_PROJECTS_SPLIT_MAX,
	sidebarProjectsSplitRatioAtom,
} from "@shared/store/atoms";
import { ProjectsLoadingView, ProjectsPanelView } from "@vetta/theme-ui/project";
import { useAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DefaultConversationSection } from "./DefaultConversationSection";
import { ProjectGroupsSection } from "./ProjectGroupsSection";
import { ProjectsPanelEmptyState } from "./ProjectsPanelEmptyState";
import { ProjectsPanelMenus } from "./ProjectsPanelMenus";
import { useProjectsPanelModel } from "./useProjectsPanelModel";
import type { ProjectsPanelProps } from "./types";

const SPLIT_HANDLE_HEIGHT = 10;
const DEFAULT_CONVERSATION_MIN_RATIO = 0.3;
const RESTORED_PROJECTS_RATIO = 0.4;

export function ProjectsPanel(props: ProjectsPanelProps): JSX.Element {
	const { t } = useTranslation("project");
	const model = useProjectsPanelModel(props);
	const [splitRatio, setSplitRatio] = useAtom(sidebarProjectsSplitRatioAtom);
	const splitContainerRef = useRef<HTMLDivElement>(null);
	const defaultConversationRegionRef = useRef<HTMLDivElement>(null);
	const [projectsScrollEl, setProjectsScrollEl] = useState<HTMLDivElement | null>(null);
	const [autoFitExpandedProject, setAutoFitExpandedProject] = useState(false);
	const [splitDragging, setSplitDragging] = useState(false);
	const previousExpandedProjectsRef = useRef<Set<string>>(new Set());

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
	// Split only when there are real project rows + default; empty placeholder stays compact.
	const showSplit = hasUserProjects && showDefaultRegion;

	useEffect(() => {
		const visibleProjectCwds = new Set([
			...model.filteredProjects.map((project) => project.cwd),
			...model.batchProjects.map(({ project }) => project.cwd),
		]);
		const expandedProjects = new Set(
			[...model.expandedProjects, ...model.expandedBatchProjects].filter((cwd) =>
				visibleProjectCwds.has(cwd),
			),
		);
		const openedProject = [...expandedProjects].some(
			(cwd) => !previousExpandedProjectsRef.current.has(cwd),
		);
		previousExpandedProjectsRef.current = expandedProjects;
		if (openedProject) {
			setAutoFitExpandedProject(true);
		} else if (expandedProjects.size === 0) {
			setAutoFitExpandedProject(false);
		}
	}, [model.batchProjects, model.expandedBatchProjects, model.expandedProjects, model.filteredProjects]);

	const handleSplitResizeStart = useCallback(() => {
		setSplitDragging(true);
		if (!autoFitExpandedProject) return;
		setSplitRatio(SIDEBAR_PROJECTS_SPLIT_MAX);
		setAutoFitExpandedProject(false);
	}, [autoFitExpandedProject, setSplitRatio]);

	const handleSplitResize = useCallback(
		(deltaY: number) => {
			const container = splitContainerRef.current;
			if (!container) return;
			const contentHeight = container.clientHeight - SPLIT_HANDLE_HEIGHT;
			if (contentHeight <= 0) return;
			setSplitRatio((prev) => clampSidebarProjectsSplitRatio(prev + deltaY / contentHeight));
		},
		[setSplitRatio],
	);
	const handleSplitResizeEnd = useCallback(() => setSplitDragging(false), []);
	// 这两个回调只负责调整分栏比例；面板过渡与导航并行，不再阻塞会话切换。
	const handleProjectInteract = useCallback(() => {
		setAutoFitExpandedProject(true);
	}, []);
	const handleDefaultSessionInteract = useCallback(() => {
		const container = splitContainerRef.current;
		const defaultConversationRegion = defaultConversationRegionRef.current;
		if (!container || !defaultConversationRegion) return;
		const contentHeight = container.clientHeight - SPLIT_HANDLE_HEIGHT;
		if (contentHeight <= 0) return;

		const renderedProjectsRatio = autoFitExpandedProject
			? SIDEBAR_PROJECTS_SPLIT_MAX
			: splitRatio;
		// The pixel minimum can lift the actual conversation ratio above the trigger threshold.
		// Use the requested ratio to detect project-expanded mode, but skip work when the
		// conversation region has already reached the restored 60% through natural sizing.
		const requestedDefaultConversationRatio = 1 - renderedProjectsRatio;
		const restoredDefaultConversationRatio = 1 - RESTORED_PROJECTS_RATIO;
		const actualDefaultConversationRatio = defaultConversationRegion.clientHeight / contentHeight;
		if (
			requestedDefaultConversationRatio >= DEFAULT_CONVERSATION_MIN_RATIO ||
			actualDefaultConversationRatio >= restoredDefaultConversationRatio
		) {
			return;
		}

		setAutoFitExpandedProject(false);
		setSplitRatio(RESTORED_PROJECTS_RATIO);
	}, [autoFitExpandedProject, setSplitRatio, splitRatio]);

	const defaultSection =
		showDefaultRegion && model.defaultProject ? (
			<DefaultConversationSection
				activeSessionPath={model.activeSessionPath}
				defaultConversationFilter={model.defaultConversationFilter}
				listClassName={props.defaultSessionListClassName}
				project={model.defaultProject}
				sessions={model.defaultSessions}
				sessionsLoading={model.defaultSessionsLoading}
				onNewSession={model.actions.defaultNewSession}
				onBeforeSelectSession={handleDefaultSessionInteract}
				onRenameSession={model.actions.renameSession}
				onSelectSession={model.actions.defaultSelectSession}
			/>
		) : null;
	if (model.projectsLoading) return <ProjectsLoadingView />;

	return (
		<ProjectsPanelView
			defaultConversationRegionRef={defaultConversationRegionRef}
			defaultSection={defaultSection}
			emptyState={<ProjectsPanelEmptyState />}
			menus={<ProjectsPanelMenus model={model} />}
			onProjectsScrollRef={setProjectsScrollEl}
			projectsScrollElement={projectsScrollEl}
			onSplitResize={handleSplitResize}
			onSplitResizeEnd={handleSplitResizeEnd}
			onSplitResizeStart={handleSplitResizeStart}
			projectsRegionCompact={showProjectsEmpty}
			projectsSection={
				hasUserProjects ? (
					<ProjectGroupsSection
						model={model}
						scrollParent={projectsScrollEl}
						onProjectInteract={handleProjectInteract}
					/>
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
			showSplit={showSplit}
			splitDragging={splitDragging}
			splitContainerRef={splitContainerRef}
			splitRatio={autoFitExpandedProject ? SIDEBAR_PROJECTS_SPLIT_MAX : splitRatio}
		/>
	);
}
