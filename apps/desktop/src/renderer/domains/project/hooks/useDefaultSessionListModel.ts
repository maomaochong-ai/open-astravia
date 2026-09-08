import type { DefaultConversationFilter } from "@shared/store/atoms";
import {
	pinnedSessionPathsAtom,
	renamingSessionPathAtom,
	runningSessionPathsAtom,
	scheduledSessionPathsAtom,
	sessionContextMenuAtom,
	sessionDisplayLabel,
} from "@shared/store/atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
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

const DEFAULT_VISIBLE_DEFAULT_SESSIONS = 5;

export interface DefaultSessionListItemView {
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

interface UseDefaultSessionListModelArgs {
	activeSessionPath: string;
	activeTeamSessionId: string;
	cwd: string;
	filter: DefaultConversationFilter;
	onNewSession?: () => void;
	onRenameSession: (cwd: string, sessionPath: string, name: string) => void;
	onSelectSession: (cwd: string, session: SidebarConversationInfo) => void;
	sessions: SidebarConversationInfo[];
}

export function useDefaultSessionListModel({
	activeSessionPath,
	activeTeamSessionId,
	cwd,
	filter,
	onNewSession,
	onRenameSession,
	onSelectSession,
	sessions,
}: UseDefaultSessionListModelArgs) {
	const { t, i18n } = useTranslation("project");
	const setContextMenu = useSetAtom(sessionContextMenuAtom);
	const viewCacheRef = useRef(new Map<string, DefaultSessionListItemView>());
	const [renamingSessionPath, setRenamingSessionPath] = useAtom(renamingSessionPathAtom);
	const runningSessionPaths = useAtomValue(runningSessionPathsAtom);
	const pinnedSessionPaths = useAtomValue(pinnedSessionPathsAtom);
	const scheduledSessionPaths = useAtomValue(scheduledSessionPathsAtom);
	const scheduledBasenames = useMemo(() => {
		const basenames = new Set<string>();
		for (const path of scheduledSessionPaths) basenames.add(path.slice(path.lastIndexOf("/") + 1));
		return basenames;
	}, [scheduledSessionPaths]);
	const [showAll, setShowAll] = useState(false);
	const ordering = useMemo(
		() => buildSidebarSessionOrdering(sessions, pinnedSessionPaths, DEFAULT_VISIBLE_DEFAULT_SESSIONS, showAll),
		[pinnedSessionPaths, sessions, showAll],
	);
	const revealedActiveSessionRef = useRef<string | null>(null);
	const [prevFilter, setPrevFilter] = useState(filter);
	if (prevFilter !== filter) {
		setPrevFilter(filter);
		setShowAll(false);
	}

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
		const collapsed = buildSidebarSessionOrdering(
			sessions,
			pinnedSessionPaths,
			DEFAULT_VISIBLE_DEFAULT_SESSIONS,
			false,
		);
		if (activeIndex >= collapsed.visible.length) setShowAll(true);
	}, [activeConversationKey, ordering.all, pinnedSessionPaths, sessions]);

	const isClaw = filter === "claw";

	// t 在 changeLanguage 后可能保持同一引用；读 i18n.language 强制语言切换时重算 timeLabel。
	const allViews: DefaultSessionListItemView[] = useMemo(() => {
		void i18n.language;
		const next = ordering.all.map((session) => {
			const identity = sidebarConversationIdentity(
				session,
				session.kind === "conversation" ? sessionDisplayLabel(session) : undefined,
			);
			const isActive = isSidebarConversationActive(session, activeSessionPath, activeTeamSessionId);
			const isRenaming = identity.mutable && renamingSessionPath === session.path;
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
				active: isActive,
				pinned: identity.mutable && pinnedSessionPaths.has(session.path),
				renaming: isRenaming,
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
		ordering.all,
		t,
	]);

	const visiblePaths = useMemo(() => new Set(ordering.visible.map(({ path }) => path)), [ordering.visible]);
	const visibleViews = allViews.filter(({ path }) => visiblePaths.has(path));

	// per-row 回调必须引用稳定，否则行组件的 memo 永远命中不了。
	const openContextMenu = useCallback(
		(event: React.MouseEvent, session: SidebarConversationInfo) => {
			if (session.kind === "agent-team") return;
			setContextMenu({ x: event.clientX, y: event.clientY, session, allowMutations: !isClaw });
		},
		[isClaw, setContextMenu],
	);
	const rename = useCallback(
		(session: SidebarConversationInfo, name: string) => {
			if (session.kind === "conversation") onRenameSession(cwd, session.path, name);
		},
		[cwd, onRenameSession],
	);
	const renameDone = useCallback(() => setRenamingSessionPath(null), [setRenamingSessionPath]);
	const select = useCallback(
		(session: SidebarConversationInfo) => onSelectSession(cwd, session),
		[cwd, onSelectSession],
	);
	const toggleShowAll = useCallback(() => setShowAll((value) => !value), []);

	const emptyLabels = isClaw
		? {
				emptyTitle: t("sidebar.defaultConversation.emptyClawTitle"),
				emptyDescription: t("sidebar.defaultConversation.emptyClawDescription"),
			}
		: {
				emptyTitle: t("sidebar.defaultConversation.emptyTitle"),
				emptyDescription: t("sidebar.defaultConversation.emptyDescription"),
				emptyAction: t("sidebar.defaultConversation.emptyAction"),
			};

	return {
		contextMenuEnabled: true,
		hasMore: ordering.hasMore,
		labels: {
			collapse: t("sidebar.projects.collapseSessions"),
			expand: t("sidebar.projects.expandMore", { count: ordering.hiddenCount }),
			...emptyLabels,
		},
		sessions: allViews,
		showAll,
		totalCount: ordering.all.length,
		visibleSessions: visibleViews,
		actions: {
			emptyAction: !isClaw && onNewSession ? onNewSession : undefined,
			openContextMenu,
			rename,
			renameDone,
			select,
			toggleShowAll,
		},
	};
}
