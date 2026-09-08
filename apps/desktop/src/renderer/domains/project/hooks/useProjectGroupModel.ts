import { pathBasename } from "@shared/lib/utils";
import type { Project, ProjectType } from "@shared/store/atoms";
import {
	pinnedSessionPathsAtom,
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
import {
	isSidebarConversationActive,
	type SidebarConversationInfo,
	sidebarConversationIdentity,
	sidebarConversationKey,
} from "../services/sidebar-conversation-projection";
import { buildSidebarSessionOrdering } from "../services/sidebar-session-order";
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
	pinned: boolean;
	leadingAvatarUrls?: readonly string[];
	titleExtra?: string;
	session: SidebarConversationInfo;
}

interface UseProjectGroupModelArgs {
	activeSessionPath: string;
	activeTeamSessionId: string;
	isActive?: boolean;
	isExpanded: boolean;
	onCollapse: (cwd: string) => void;
	onExpand: (cwd: string) => void;
	onNavigateProject: (cwd: string) => void;
	onNewSession: (cwd: string) => void;
	onRenameSession: (cwd: string, sessionPath: string, name: string) => void;
	onSelectSession: (cwd: string, session: SidebarConversationInfo) => void;
	project: Project;
	sessions: SidebarConversationInfo[];
}

export function useProjectGroupModel({
	activeSessionPath,
	activeTeamSessionId,
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
	const setContextMenu = useSetAtom(sessionContextMenuAtom);
	const setProjectContextMenu = useSetAtom(projectContextMenuAtom);
	const renamingSessionPath = useAtomValue(renamingSessionPathAtom);
	const setRenamingSessionPath = useSetAtom(renamingSessionPathAtom);
	const viewCacheRef = useRef(new Map<string, ProjectGroupSessionView>());
	const [showAllSessions, setShowAllSessions] = useState(false);
	const revealedActiveSessionRef = useRef<string | null>(null);
	const runningSessionPaths = useAtomValue(runningSessionPathsAtom);
	const pinnedSessionPaths = useAtomValue(pinnedSessionPathsAtom);
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
	const ordering = useMemo(
		() => buildSidebarSessionOrdering(sessions, pinnedSessionPaths, DEFAULT_VISIBLE_SESSIONS, showAllSessions),
		[pinnedSessionPaths, sessions, showAllSessions],
	);

	useEffect(() => {
		if (!isExpanded) setShowAllSessions(false);
	}, [isExpanded]);

	const activeConversationKey = activeTeamSessionId
		? `agent-team:${activeTeamSessionId}`
		: activeSessionPath
			? `conversation:${activeSessionPath}`
			: "";
	useEffect(() => {
		if (!activeConversationKey) {
			revealedActiveSessionRef.current = null;
			return;
		}
		if (revealedActiveSessionRef.current === activeConversationKey) return;
		const activeIndex = ordering.all.findIndex(
			(session) => sidebarConversationKey(session) === activeConversationKey,
		);
		if (activeIndex < 0) return;
		revealedActiveSessionRef.current = activeConversationKey;
		const collapsed = buildSidebarSessionOrdering(sessions, pinnedSessionPaths, DEFAULT_VISIBLE_SESSIONS, false);
		if (activeIndex >= collapsed.visible.length) setShowAllSessions(true);
	}, [activeConversationKey, ordering.all, pinnedSessionPaths, sessions]);

	const displayName = project.name ?? pathBasename(project.cwd);
	const projectType = project.type;
	const projectBadge = getProjectBadge(project, projectType, t);

	// t 在 changeLanguage 后可能保持同一引用；读 i18n.language 强制语言切换时重算 timeLabel。
	const sessionViews: ProjectGroupSessionView[] = useMemo(() => {
		void i18n.language;
		const next = ordering.visible.map((session) => {
			const identity = sidebarConversationIdentity(
				session,
				session.kind === "conversation" ? sessionDisplayLabel(session) : undefined,
			);
			const isSessionActive = isSidebarConversationActive(session, activeSessionPath, activeTeamSessionId);
			const isRunning = identity.mutable && runningSessionPaths.has(session.path);
			const isSchedule =
				identity.mutable &&
				(scheduledSessionPaths.has(session.path) ||
					scheduledBasenames.has(session.path.slice(session.path.lastIndexOf("/") + 1)));
			return {
				key: identity.key,
				path: session.path,
				label: identity.label,
				timeLabel: relativeTime(session.modifiedAt, t),
				active: isSessionActive,
				pinned: identity.mutable && pinnedSessionPaths.has(session.path),
				renaming: identity.mutable && renamingSessionPath === session.path,
				running: isRunning,
				scheduled: isSchedule,
				leadingAvatarUrls: identity.leadingAvatarUrls,
				titleExtra: identity.titleExtra,
				session,
			};
		});
		// 未变的行还回旧引用，让下游行组件的 memo 生效。
		return reuseUnchangedSessionViews(viewCacheRef.current, next);
	}, [
		activeSessionPath,
		activeTeamSessionId,
		i18n.language,
		renamingSessionPath,
		runningSessionPaths,
		pinnedSessionPaths,
		scheduledBasenames,
		scheduledSessionPaths,
		t,
		ordering.visible,
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
		(event: React.MouseEvent, session: SidebarConversationInfo) => {
			event.preventDefault();
			if (session.kind === "agent-team") return;
			setContextMenu({ x: event.clientX, y: event.clientY, session, allowMutations: true });
		},
		[setContextMenu],
	);
	const renameDone = useCallback(() => setRenamingSessionPath(null), [setRenamingSessionPath]);
	const renameSessionByPath = useCallback(
		(session: SidebarConversationInfo, name: string) => {
			if (session.kind === "conversation") onRenameSession(projectCwd, session.path, name);
		},
		[onRenameSession, projectCwd],
	);
	const selectSessionByPath = useCallback(
		(session: SidebarConversationInfo) => onSelectSession(projectCwd, session),
		[onSelectSession, projectCwd],
	);
	const toggleShowAll = useCallback(() => setShowAllSessions((value) => !value), []);

	return {
		displayName,
		expanded: isExpanded,
		hasMoreSessions: ordering.hasMore,
		hasRunning: projectHasRunning,
		hiddenCount: ordering.hiddenCount,
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
			expand: t("sidebar.projects.expandMore", { count: ordering.hiddenCount }),
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
