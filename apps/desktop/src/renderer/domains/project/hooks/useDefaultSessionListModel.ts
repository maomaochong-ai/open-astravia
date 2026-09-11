import { notifyTeamSessionsChanged } from "@shared/agent-teams/team-session-events";
import type { DefaultConversationFilter } from "@shared/store/atoms";
import {
	conversationFilterTagId,
	conversationTagsAtom,
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
import { conversationTagIds } from "../../../../shared/conversation-tags";
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
	active: boolean;
	renaming: boolean;
	running: boolean;
	scheduled: boolean;
	pinned: boolean;
	iconClassName?: string;
	trailingAvatarUrls?: readonly string[];
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
	const tags = useAtomValue(conversationTagsAtom);
	const tagFilterId = conversationFilterTagId(filter);
	// 标签档只收窄可见集合，不改变来源与排序；「对话」档仍包含已打标的会话。
	const taggedSessions = useMemo(
		() =>
			tagFilterId === null
				? sessions
				: sessions.filter((session) => conversationTagIds(tags, session.path).includes(tagFilterId)),
		[sessions, tagFilterId, tags],
	);
	const ordering = useMemo(
		() => buildSidebarSessionOrdering(taggedSessions, pinnedSessionPaths, DEFAULT_VISIBLE_DEFAULT_SESSIONS, showAll),
		[pinnedSessionPaths, taggedSessions, showAll],
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
			taggedSessions,
			pinnedSessionPaths,
			DEFAULT_VISIBLE_DEFAULT_SESSIONS,
			false,
		);
		if (activeIndex >= collapsed.visible.length) setShowAll(true);
	}, [activeConversationKey, ordering.all, pinnedSessionPaths, taggedSessions]);

	const isClaw = filter === "claw";

	// t 在 changeLanguage 后可能保持同一引用；读 i18n.language 强制语言切换时重算未命名团队会话文案。
	const allViews: DefaultSessionListItemView[] = useMemo(() => {
		void i18n.language;
		const next = ordering.all.map((session) => {
			const identity = sidebarConversationIdentity(session, {
				conversationLabel: session.kind === "conversation" ? sessionDisplayLabel(session) : undefined,
				untitledTeamLabel: t("sidebar.session.untitledTeam"),
			});
			const isActive = isSidebarConversationActive(session, activeSessionPath, activeTeamSessionId);
			const isRenaming = identity.mutable && renamingSessionPath === session.path;
			const isRunning = runningSessionPaths.has(session.path);
			const isSchedule =
				identity.mutable &&
				(scheduledSessionPaths.has(session.path) ||
					scheduledBasenames.has(session.path.slice(session.path.lastIndexOf("/") + 1)));
			return {
				key: identity.key,
				path: session.path,
				label: identity.label,
				active: isActive,
				pinned: pinnedSessionPaths.has(session.path),
				renaming: isRenaming,
				running: isRunning,
				scheduled: isSchedule,
				iconClassName: identity.iconClassName,
				trailingAvatarUrls: identity.trailingAvatarUrls,
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
			setContextMenu({
				x: event.clientX,
				y: event.clientY,
				session,
				allowMutations: !isClaw,
				canTag: !isClaw,
			});
		},
		[isClaw, setContextMenu],
	);
	const rename = useCallback(
		(session: SidebarConversationInfo, name: string) => {
			if (session.kind === "conversation") {
				onRenameSession(cwd, session.path, name);
				return;
			}
			void window.vetta.agentTeams
				.renameSession({ id: session.teamSessionId, coordinationSessionPath: session.path }, name)
				.then(() => {
					notifyTeamSessionsChanged(session.teamId);
				});
		},
		[cwd, onRenameSession],
	);
	const renameDone = useCallback(() => setRenamingSessionPath(null), [setRenamingSessionPath]);
	const select = useCallback(
		(session: SidebarConversationInfo) => onSelectSession(cwd, session),
		[cwd, onSelectSession],
	);
	const toggleShowAll = useCallback(() => setShowAll((value) => !value), []);

	const emptyLabels = tagFilterId
		? {
				emptyTitle: t("sidebar.defaultConversation.emptyTagTitle"),
				emptyDescription: t("sidebar.defaultConversation.emptyTagDescription"),
				emptyAction: t("sidebar.defaultConversation.emptyAction"),
			}
		: isClaw
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
			// 标签档下也给「开始新对话」：新建的会话会继承当前标签，不会开完就看不见。
			emptyAction: !isClaw && onNewSession ? onNewSession : undefined,
			openContextMenu,
			rename,
			renameDone,
			select,
			toggleShowAll,
		},
	};
}
