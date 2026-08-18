import { pathBasename } from "@shared/lib/utils";
import type { Project, ProjectType, SessionInfo } from "@shared/store/atoms";
import {
	projectContextMenuAtom,
	renamingSessionPathAtom,
	runningSessionPathsAtom,
	scheduledSessionPathsAtom,
	sessionContextMenuAtom,
	sessionDisplayLabel,
} from "@shared/store/atoms";
import { DEFAULT_VISIBLE_SESSIONS } from "@vetta/theme-ui/project";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { relativeTime } from "../components/sidebar/projects/relativeTime";
import { reuseUnchangedSessionViews } from "./stableSessionViews";

export interface ProjectGroupSessionView {
	key: string;
	path: string;
	label: string;
	timeLabel: string;
	active: boolean;
	renaming: boolean;
	running: boolean;
	scheduled: boolean;
	session: SessionInfo;
}

interface UseProjectGroupModelArgs {
	activeSessionPath: string;
	isActive?: boolean;
	isExpanded: boolean;
	onCollapse: (cwd: string) => void;
	onExpand: (cwd: string) => void;
	onNavigateProject: (cwd: string) => void;
	onNewSession: (cwd: string) => void;
	onRenameSession: (cwd: string, sessionPath: string, name: string) => void;
	onSelectSession: (cwd: string, sessionPath: string) => void;
	project: Project;
	sessions: SessionInfo[];
}

export function useProjectGroupModel({
	activeSessionPath,
	isActive = false,
	isExpanded,
	onCollapse,
	onExpand,
	onNavigateProject,
	onNewSession,
	onRenameSession,
	onSelectSession,
	project,
	sessions,
}: UseProjectGroupModelArgs) {
	const { t, i18n } = useTranslation("project");
	const sortedSessions = useMemo(() => [...sessions].sort((a, b) => b.modifiedAt - a.modifiedAt), [sessions]);
	const setContextMenu = useSetAtom(sessionContextMenuAtom);
	const setProjectContextMenu = useSetAtom(projectContextMenuAtom);
	const renamingSessionPath = useAtomValue(renamingSessionPathAtom);
	const setRenamingSessionPath = useSetAtom(renamingSessionPathAtom);
	const viewCacheRef = useRef(new Map<string, ProjectGroupSessionView>());
	const [showAllSessions, setShowAllSessions] = useState(false);
	const revealedActiveSessionRef = useRef<string | null>(null);
	const runningSessionPaths = useAtomValue(runningSessionPathsAtom);
	const scheduledSessionPaths = useAtomValue(scheduledSessionPathsAtom);
	const scheduledBasenames = useMemo(() => {
		const basenames = new Set<string>();
		for (const path of scheduledSessionPaths) basenames.add(path.slice(path.lastIndexOf("/") + 1));
		return basenames;
	}, [scheduledSessionPaths]);
	const projectHasRunning = useMemo(
		() => sessions.some((session) => runningSessionPaths.has(session.path)),
		[sessions, runningSessionPaths],
	);

	useEffect(() => {
		if (!isExpanded) setShowAllSessions(false);
	}, [isExpanded]);

	useEffect(() => {
		if (!activeSessionPath) {
			revealedActiveSessionRef.current = null;
			return;
		}
		if (revealedActiveSessionRef.current === activeSessionPath) return;
		const activeIndex = sortedSessions.findIndex((session) => session.path === activeSessionPath);
		if (activeIndex < 0) return;
		revealedActiveSessionRef.current = activeSessionPath;
		if (activeIndex >= DEFAULT_VISIBLE_SESSIONS) setShowAllSessions(true);
	}, [activeSessionPath, sortedSessions]);

	const hasMoreSessions = sortedSessions.length > DEFAULT_VISIBLE_SESSIONS;
	const visibleSessions = showAllSessions ? sortedSessions : sortedSessions.slice(0, DEFAULT_VISIBLE_SESSIONS);
	const hiddenCount = sortedSessions.length - DEFAULT_VISIBLE_SESSIONS;
	const displayName = project.name ?? pathBasename(project.cwd);
	const projectType = project.type;
	const projectBadge = getProjectBadge(project, projectType, t);

	// t 在 changeLanguage 后可能保持同一引用；读 i18n.language 强制语言切换时重算 timeLabel。
	const sessionViews: ProjectGroupSessionView[] = useMemo(() => {
		void i18n.language;
		const next = visibleSessions.map((session) => {
			const isSessionActive = activeSessionPath === session.path;
			const isRunning = runningSessionPaths.has(session.path);
			const isSchedule =
				scheduledSessionPaths.has(session.path) ||
				scheduledBasenames.has(session.path.slice(session.path.lastIndexOf("/") + 1));
			return {
				key: session.path,
				path: session.path,
				label: sessionDisplayLabel(session),
				timeLabel: relativeTime(session.modifiedAt, t),
				active: isSessionActive,
				renaming: renamingSessionPath === session.path,
				running: isRunning,
				scheduled: isSchedule,
				session,
			};
		});
		// 未变的行还回旧引用，让下游行组件的 memo 生效。
		return reuseUnchangedSessionViews(viewCacheRef.current, next);
	}, [
		activeSessionPath,
		i18n.language,
		renamingSessionPath,
		runningSessionPaths,
		scheduledBasenames,
		scheduledSessionPaths,
		t,
		visibleSessions,
	]);

	// per-row 回调必须引用稳定，否则行组件的 memo 永远命中不了。
	const projectCwd = project.cwd;
	const collapse = useCallback(() => onCollapse(projectCwd), [onCollapse, projectCwd]);
	const expand = useCallback(() => onExpand(projectCwd), [onExpand, projectCwd]);
	const navigateProject = useCallback(() => onNavigateProject(projectCwd), [onNavigateProject, projectCwd]);
	const newSession = useCallback(() => onNewSession(projectCwd), [onNewSession, projectCwd]);
	const openProjectContextMenu = useCallback(
		(event: React.MouseEvent) => {
			event.preventDefault();
			setProjectContextMenu({ x: event.clientX, y: event.clientY, project });
		},
		[project, setProjectContextMenu],
	);
	const openSessionContextMenu = useCallback(
		(event: React.MouseEvent, session: SessionInfo) => {
			event.preventDefault();
			setContextMenu({ x: event.clientX, y: event.clientY, session });
		},
		[setContextMenu],
	);
	const renameDone = useCallback(() => setRenamingSessionPath(null), [setRenamingSessionPath]);
	const renameSessionByPath = useCallback(
		(sessionPath: string, name: string) => onRenameSession(projectCwd, sessionPath, name),
		[onRenameSession, projectCwd],
	);
	const selectSessionByPath = useCallback(
		(sessionPath: string) => onSelectSession(projectCwd, sessionPath),
		[onSelectSession, projectCwd],
	);
	const toggleShowAll = useCallback(() => setShowAllSessions((value) => !value), []);

	return {
		displayName,
		expanded: isExpanded,
		hasMoreSessions,
		hasRunning: projectHasRunning,
		hiddenCount,
		isActive,
		newSessionTitle: t("sidebar.nav.newSession"),
		noSessionsLabel: t("sidebar.projects.noSessions"),
		project,
		projectBadge,
		projectType,
		sessionViews,
		showAllSessions,
		showMoreLabels: {
			collapse: t("sidebar.projects.collapseSessions"),
			expand: t("sidebar.projects.expandMore", { count: hiddenCount }),
		},
		actions: {
			collapse,
			expand,
			navigateProject,
			newSession,
			openProjectContextMenu,
			openSessionContextMenu,
			renameDone,
			renameSession: renameSessionByPath,
			selectSession: selectSessionByPath,
			toggleShowAll,
		},
	};
}

function getProjectBadge(
	_project: Project,
	projectType: ProjectType,
	t: (key: "detail.typeBatch") => string,
): string | undefined {
	if (projectType === "normal") return undefined;
	return t("detail.typeBatch");
}
