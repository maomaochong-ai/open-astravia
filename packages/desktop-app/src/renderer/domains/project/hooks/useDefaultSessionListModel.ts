import type { DefaultConversationFilter, SessionInfo } from "@shared/store/atoms";
import {
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
	session: SessionInfo;
}

interface UseDefaultSessionListModelArgs {
	activeSessionPath: string;
	cwd: string;
	filter: DefaultConversationFilter;
	onNewSession?: () => void;
	onRenameSession: (cwd: string, sessionPath: string, name: string) => void;
	onSelectSession: (cwd: string, sessionPath: string) => void;
	sessions: SessionInfo[];
}

export function useDefaultSessionListModel({
	activeSessionPath,
	cwd,
	filter,
	onNewSession,
	onRenameSession,
	onSelectSession,
	sessions,
}: UseDefaultSessionListModelArgs) {
	const { t, i18n } = useTranslation("project");
	const sorted = useMemo(() => [...sessions].sort((a, b) => b.modifiedAt - a.modifiedAt), [sessions]);
	const setContextMenu = useSetAtom(sessionContextMenuAtom);
	const viewCacheRef = useRef(new Map<string, DefaultSessionListItemView>());
	const [renamingSessionPath, setRenamingSessionPath] = useAtom(renamingSessionPathAtom);
	const runningSessionPaths = useAtomValue(runningSessionPathsAtom);
	const scheduledSessionPaths = useAtomValue(scheduledSessionPathsAtom);
	const scheduledBasenames = useMemo(() => {
		const basenames = new Set<string>();
		for (const path of scheduledSessionPaths) basenames.add(path.slice(path.lastIndexOf("/") + 1));
		return basenames;
	}, [scheduledSessionPaths]);
	const [showAll, setShowAll] = useState(false);
	const revealedActiveSessionRef = useRef<string | null>(null);
	const [prevFilter, setPrevFilter] = useState(filter);
	if (prevFilter !== filter) {
		setPrevFilter(filter);
		setShowAll(false);
	}

	useEffect(() => {
		if (!activeSessionPath) {
			revealedActiveSessionRef.current = null;
			return;
		}
		if (revealedActiveSessionRef.current === activeSessionPath) return;
		const activeIndex = sorted.findIndex((session) => session.path === activeSessionPath);
		if (activeIndex < 0) return;
		revealedActiveSessionRef.current = activeSessionPath;
		if (activeIndex >= DEFAULT_VISIBLE_DEFAULT_SESSIONS) setShowAll(true);
	}, [activeSessionPath, sorted]);

	const hasMore = sorted.length > DEFAULT_VISIBLE_DEFAULT_SESSIONS;
	const hiddenCount = sorted.length - DEFAULT_VISIBLE_DEFAULT_SESSIONS;
	const isClaw = filter === "claw";

	// t 在 changeLanguage 后可能保持同一引用；读 i18n.language 强制语言切换时重算 timeLabel。
	const allViews: DefaultSessionListItemView[] = useMemo(() => {
		void i18n.language;
		const next = sorted.map((session) => {
			const isActive = activeSessionPath === session.path;
			const isRenaming = renamingSessionPath === session.path;
			const isRunning = runningSessionPaths.has(session.path);
			const isSchedule =
				scheduledSessionPaths.has(session.path) ||
				scheduledBasenames.has(session.path.slice(session.path.lastIndexOf("/") + 1));
			return {
				key: session.path,
				path: session.path,
				label: sessionDisplayLabel(session),
				timeLabel: relativeTime(session.modifiedAt, t),
				active: isActive,
				renaming: isRenaming,
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
		sorted,
		t,
	]);

	const visibleViews = showAll ? allViews : allViews.slice(0, DEFAULT_VISIBLE_DEFAULT_SESSIONS);

	// per-row 回调必须引用稳定，否则行组件的 memo 永远命中不了。
	const openContextMenu = useCallback(
		(event: React.MouseEvent, session: SessionInfo) => {
			setContextMenu({ x: event.clientX, y: event.clientY, session });
		},
		[setContextMenu],
	);
	const rename = useCallback(
		(sessionPath: string, name: string) => onRenameSession(cwd, sessionPath, name),
		[cwd, onRenameSession],
	);
	const renameDone = useCallback(() => setRenamingSessionPath(null), [setRenamingSessionPath]);
	const select = useCallback((sessionPath: string) => onSelectSession(cwd, sessionPath), [cwd, onSelectSession]);
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
		contextMenuEnabled: !isClaw,
		hasMore,
		labels: {
			collapse: t("sidebar.projects.collapseSessions"),
			expand: t("sidebar.projects.expandMore", { count: hiddenCount }),
			...emptyLabels,
		},
		sessions: allViews,
		showAll,
		totalCount: sorted.length,
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
