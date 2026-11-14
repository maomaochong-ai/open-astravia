import { isSshProjectUri } from "@astravia/ssh-transport/project-uri";
import type {
	CommandMenuItemView,
	ManageSessionsMenuItemView,
	ManageSessionsSplashViewProps,
	ManageSessionsTabView,
} from "@astravia-org/theme-ui/project";
import { notifyTeamSessionsChanged } from "@shared/agent-teams/team-session-events";
import {
	automationSessionLinksAtom,
	confirmDialogAtom,
	conversationTagEditorAtom,
	conversationTagsAtom,
	manageSessionsProjectAtom,
	pinnedSessionPathsAtom,
	runningSessionPathsAtom,
	sessionDisplayLabel,
	setSessionPinnedAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { conversationTagIds } from "../../../../shared/conversation-tags";
import type { ProjectsPanelModel } from "../components/sidebar/projects/panel/types";
import { filterManageSessions, moveSelection, selectionAfterRemoval } from "../services/manage-sessions";
import { type SidebarConversationInfo, sidebarConversationIdentity } from "../services/sidebar-conversation-projection";
import { buildSidebarSessionOrdering } from "../services/sidebar-session-order";

const isMac = navigator.platform.toUpperCase().includes("MAC");
const MODIFIER_LABEL = isMac ? "Control" : "Ctrl";

type MenuKind = "actions" | "tags";

const ALL_TAB_ID = "all";

interface SessionView {
	readonly id: string;
	readonly label: string;
	readonly iconClassName?: string;
	readonly session: SidebarConversationInfo;
}

/**
 * 「管理会话」面板的状态与动作。数据来自侧栏同一份 panel model（置顶排序、团队会话等规则一致），
 * 单个会话的操作沿用侧栏右键菜单的同一批 atom / 接口，不另起一套。
 *
 * 面板要的是「找到并清掉」这一件事，所以所有快捷键都收在这里：
 * list 步骤里 Ctrl/Cmd+X 直接删除（不逐条确认，选中项落到相邻行）、Ctrl/Cmd+K 打开更多操作、
 * Tab 在标签页间循环；menu 步骤里方向键选、回车执行、Esc 返回。
 */
export function useManageSessionsModel(panel: ProjectsPanelModel): ManageSessionsSplashViewProps {
	const { t, i18n } = useTranslation("project");
	const [project, setProject] = useAtom(manageSessionsProjectAtom);
	const open = project !== null;
	// 关闭动画期间 project 已经是 null，保留最后一个，面板淡出时内容不会瞬间清空。
	const lastProjectRef = useRef(project);
	if (project) lastProjectRef.current = project;
	const shown = project ?? lastProjectRef.current;

	const pinnedPaths = useAtomValue(pinnedSessionPathsAtom);
	const runningPaths = useAtomValue(runningSessionPathsAtom);
	const automationLinks = useAtomValue(automationSessionLinksAtom);
	const tags = useAtomValue(conversationTagsAtom);
	const setPinned = useSetAtom(setSessionPinnedAtom);
	const setConfirm = useSetAtom(confirmDialogAtom);
	const openTagEditor = useSetAtom(conversationTagEditorAtom);

	const [step, setStep] = useState<ManageSessionsSplashViewProps["step"]>("list");
	const [menuKind, setMenuKind] = useState<MenuKind>("actions");
	const [query, setQuery] = useState("");
	const [tabId, setTabId] = useState(ALL_TAB_ID);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [targetId, setTargetId] = useState<string | null>(null);
	const [menuActiveId, setMenuActiveId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");

	// 每次打开都从干净的列表开始，不带上次的搜索词与步骤。
	useEffect(() => {
		if (!open) return;
		setStep("list");
		setMenuKind("actions");
		setQuery("");
		setTabId(ALL_TAB_ID);
		setSelectedId(null);
		setTargetId(null);
	}, [open]);

	const isDefault = shown?.isDefault === true;
	const isClaw = isDefault && panel.defaultConversationFilter === "claw";
	const allowMutations = !isClaw;
	const canTag = isDefault && !isClaw;
	const sessionsCwd = shown ? (isDefault ? panel.defaultSessionsCwd || shown.cwd : shown.cwd) : "";
	// 项目没展开过时 sessionsMap 里还没有它的会话，打开面板就主动加载。
	const loadSessionsRef = useRef(panel.actions.loadSessions);
	loadSessionsRef.current = panel.actions.loadSessions;
	useEffect(() => {
		if (open && sessionsCwd) loadSessionsRef.current(sessionsCwd);
	}, [open, sessionsCwd]);
	const sessionsLoading = shown
		? isDefault
			? panel.defaultSessionsLoading
			: panel.projectSessionsLoading(shown.cwd)
		: false;
	const rawSessions = shown ? (isDefault ? panel.defaultSessions : panel.projectSessions(shown.cwd)) : [];

	const views = useMemo<SessionView[]>(() => {
		void i18n.language;
		const ordered = buildSidebarSessionOrdering(rawSessions, pinnedPaths, Number.MAX_SAFE_INTEGER, true).all;
		return ordered.map((session) => {
			const identity = sidebarConversationIdentity(session, {
				conversationLabel: session.kind === "conversation" ? sessionDisplayLabel(session) : undefined,
				untitledTeamLabel: t("sidebar.session.untitledTeam"),
			});
			return { id: identity.key, label: identity.label, iconClassName: identity.iconClassName, session };
		});
	}, [rawSessions, pinnedPaths, t, i18n.language]);

	// 标签页只给「对话」：项目内会话没有标签，且至少有一个标签才有切换的意义。
	const tabs = useMemo<ManageSessionsTabView[]>(
		() =>
			canTag && tags.tags.length > 0
				? [
						{ id: ALL_TAB_ID, label: t("manageSessions.tabAll") },
						...tags.tags.map((tag) => ({ id: tag.id, label: tag.name, dotColor: tag.color })),
					]
				: [],
		[canTag, t, tags.tags],
	);
	const activeTabId = tabs.some((tab) => tab.id === tabId) ? tabId : ALL_TAB_ID;
	const tabViews = useMemo(
		() =>
			activeTabId === ALL_TAB_ID
				? views
				: views.filter((view) => conversationTagIds(tags, view.session.path).includes(activeTabId)),
		[activeTabId, tags, views],
	);
	const matches = useMemo(() => filterManageSessions(tabViews, query), [tabViews, query]);
	const rowIds = useMemo(() => matches.map((match) => match.item.id), [matches]);
	const effectiveSelectedId = selectedId !== null && rowIds.includes(selectedId) ? selectedId : (rowIds[0] ?? null);
	const viewById = useMemo(() => new Map(views.map((view) => [view.id, view])), [views]);
	const targetView = targetId ? viewById.get(targetId) : undefined;

	const tagColorsOf = useCallback(
		(path: string): readonly string[] | undefined => {
			const colors = conversationTagIds(tags, path)
				.map((id) => tags.tags.find((tag) => tag.id === id)?.color)
				.filter((color): color is string => Boolean(color));
			return colors.length > 0 ? colors : undefined;
		},
		[tags],
	);

	const rows = useMemo<CommandMenuItemView[]>(
		() =>
			matches.map(({ item, ranges }) => ({
				id: item.id,
				title: item.label,
				titleHighlights: ranges,
				subtitle: new Date(item.session.modifiedAt).toLocaleDateString(i18n.language, {
					month: "numeric",
					day: "numeric",
				}),
				icon: pinnedPaths.has(item.session.path)
					? "icon-[solar--pin-bold]"
					: (item.iconClassName ?? "icon-[solar--chat-round-line-linear]"),
				tagColors: canTag ? tagColorsOf(item.session.path) : undefined,
				badge: runningPaths.has(item.session.path) ? t("manageSessions.running") : undefined,
			})),
		[canTag, i18n.language, matches, pinnedPaths, runningPaths, t, tagColorsOf],
	);

	const close = useCallback(() => setProject(null), [setProject]);

	const canDeleteSession = useCallback(
		(session: SidebarConversationInfo): boolean =>
			allowMutations && (session.kind !== "conversation" || session.access?.delete !== false),
		[allowMutations],
	);
	const canRenameSession = useCallback(
		(session: SidebarConversationInfo): boolean =>
			allowMutations && (session.kind !== "conversation" || session.access?.rename !== false),
		[allowMutations],
	);

	const deleteView = useCallback(
		(view: SessionView): void => {
			const { session } = view;
			if (!canDeleteSession(session)) return;
			const run = (): void => {
				// 会话没了，它留下的标签就是孤儿；与侧栏删除保持一致。
				void window.astravia.conversationTags.forgetConversations([session.path]);
				panel.actions.deleteSession(session);
			};
			const bound = automationLinks.get(session.path);
			if (bound?.mode === "same-session") {
				// 删掉「同一个会话」自动化绑定的会话会让该自动化暂停，这一种不能静默删。
				setConfirm({
					title: t("sidebar.dialogs.deleteSessionTitle"),
					message: `${t("sidebar.dialogs.deleteSessionMessage", { name: view.label })}\n\n${t(
						"sidebar.dialogs.deleteBoundSessionHint",
						{ task: bound.taskName },
					)}`,
					confirmLabel: t("sidebar.dialogs.deleteConfirm"),
					variant: "danger",
					onConfirm: run,
				});
				return;
			}
			// 「快速删除」：不再逐条确认，选中项落到相邻一行，可以连续删。
			setSelectedId(selectionAfterRemoval(rowIds, view.id));
			run();
		},
		[automationLinks, canDeleteSession, panel.actions, rowIds, setConfirm, t],
	);

	const openRow = useCallback(
		(id: string): void => {
			const view = viewById.get(id);
			if (!view) return;
			close();
			if (isDefault) panel.actions.defaultSelectSession(sessionsCwd, view.session);
			else panel.actions.selectSession(sessionsCwd, view.session);
		},
		[close, isDefault, panel.actions, sessionsCwd, viewById],
	);

	const runningInScope = views.some((view) => runningPaths.has(view.session.path));
	const clearAll = useCallback((): void => {
		if (!shown || runningInScope) return;
		const sessions = views.map((view) => view.session);
		close();
		if (isDefault) {
			if (isClaw) panel.actions.clearClaw(shown.cwd);
			else panel.actions.clearConversation(shown.cwd);
			return;
		}
		setConfirm({
			title: t("manageSessions.clearProjectTitle"),
			message: t("manageSessions.clearProjectMessage", {
				count: sessions.length,
				name: shown.name ?? shown.cwd,
			}),
			confirmLabel: t("sidebar.dialogs.clearConfirm"),
			variant: "danger",
			onConfirm: () => {
				for (const session of sessions) panel.actions.deleteSession(session);
			},
		});
	}, [close, isClaw, isDefault, panel.actions, runningInScope, setConfirm, shown, t, views]);

	const menuItems = useMemo<ManageSessionsMenuItemView[]>(() => {
		if (!targetView) return [];
		const { session } = targetView;
		if (menuKind === "tags") {
			const assigned = new Set(conversationTagIds(tags, session.path));
			return [
				...tags.tags.map((tag) => ({
					id: `tag:${tag.id}`,
					label: tag.name,
					dotColor: tag.color,
					checked: assigned.has(tag.id),
				})),
				{ id: "tag-new", label: t("contextMenu.tags.new"), icon: "icon-[solar--add-circle-linear]" },
			];
		}
		const pinned = pinnedPaths.has(session.path);
		const items: ManageSessionsMenuItemView[] = [
			{
				id: "pin",
				label: pinned ? t("contextMenu.unpin") : t("contextMenu.pin"),
				icon: "icon-[solar--pin-linear]",
			},
		];
		if (canRenameSession(session)) {
			items.push({ id: "rename", label: t("contextMenu.rename"), icon: "icon-[solar--pen-2-linear]" });
		}
		if (canTag) {
			items.push({ id: "tags", label: t("manageSessions.moveToTag"), icon: "icon-[solar--tag-linear]" });
		}
		// 远程项目下的会话，工作目录在远端，系统文件管理器无从显示。
		if (!isSshProjectUri(session.cwd)) {
			items.push({
				id: "open-in-folder",
				label: isMac ? t("contextMenu.openInFinder") : t("contextMenu.openInExplorer"),
				icon: "icon-[solar--folder-open-linear]",
			});
		}
		if (canDeleteSession(session)) {
			items.push({
				id: "delete",
				label: t("contextMenu.delete"),
				icon: "icon-[solar--trash-bin-trash-linear]",
				danger: true,
				shortcut: `${MODIFIER_LABEL} X`,
			});
		}
		return items;
	}, [canDeleteSession, canRenameSession, canTag, menuKind, pinnedPaths, t, tags, targetView]);

	const menuIds = useMemo(() => menuItems.filter((item) => !item.disabled).map((item) => item.id), [menuItems]);
	const effectiveMenuActiveId =
		menuActiveId !== null && menuIds.includes(menuActiveId) ? menuActiveId : (menuIds[0] ?? null);

	const backToList = useCallback((): void => {
		setStep("list");
		setMenuKind("actions");
	}, []);

	const openMenuFor = useCallback(
		(id: string | null): void => {
			if (!id) return;
			const view = viewById.get(id);
			if (!view) return;
			setTargetId(id);
			setMenuKind("actions");
			setMenuActiveId(null);
			setStep("menu");
		},
		[viewById],
	);

	const selectMenuItem = useCallback(
		(id: string): void => {
			if (!targetView) return;
			const { session } = targetView;
			if (menuKind === "tags") {
				if (id === "tag-new") {
					// 标签编辑是另一个对话框，层级在 Splash 之下，先收起面板再打开。
					close();
					openTagEditor({ mode: "create", sessionPath: session.path });
					return;
				}
				const tagId = id.slice("tag:".length);
				const assigned = new Set(conversationTagIds(tags, session.path)).has(tagId);
				void window.astravia.conversationTags.assign({ sessionPath: session.path, tagId, assigned: !assigned });
				backToList();
				return;
			}
			switch (id) {
				case "pin":
					setPinned({ path: session.path, pinned: !pinnedPaths.has(session.path) });
					backToList();
					return;
				case "rename":
					setRenameValue(targetView.label);
					setStep("rename");
					return;
				case "tags":
					setMenuKind("tags");
					setMenuActiveId(null);
					return;
				case "open-in-folder":
					void window.astravia.shell.showInFolder(session.cwd);
					close();
					return;
				case "delete":
					deleteView(targetView);
					backToList();
					return;
			}
		},
		[backToList, close, deleteView, menuKind, openTagEditor, pinnedPaths, setPinned, tags, targetView],
	);

	const moreRow = useCallback(
		(id: string): void => {
			setSelectedId(id);
			openMenuFor(id);
		},
		[openMenuFor],
	);

	const submitRename = useCallback((): void => {
		const name = renameValue.trim();
		if (!targetView || !name || name === targetView.label) {
			backToList();
			return;
		}
		const { session } = targetView;
		if (session.kind === "conversation") {
			panel.actions.renameSession(sessionsCwd, session.path, name);
		} else {
			void window.astravia.agentTeams
				.renameSession({ id: session.teamSessionId, coordinationSessionPath: session.path }, name)
				.then(() => notifyTeamSessionsChanged(session.teamId));
		}
		backToList();
	}, [backToList, panel.actions, renameValue, sessionsCwd, targetView]);

	const goBack = useCallback((): void => {
		if (step === "menu" && menuKind === "tags") {
			setMenuKind("actions");
			setMenuActiveId(null);
			return;
		}
		backToList();
	}, [backToList, menuKind, step]);

	// 快捷键走 window 监听：list 步骤焦点在搜索框、menu 步骤没有输入框，统一在这里处理。
	// 处理函数每次渲染更新到 ref，监听本身只挂一次。
	const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
	keyHandlerRef.current = (event) => {
		if (event.isComposing) return;
		const key = event.key.toLowerCase();
		const ctrl = event.ctrlKey && !event.metaKey && !event.altKey;
		if (step === "list") {
			if (key === "escape") return close();
			if (key === "arrowdown" || key === "arrowup") {
				event.preventDefault();
				setSelectedId(moveSelection(rowIds, effectiveSelectedId, key === "arrowdown" ? 1 : -1));
				return;
			}
			if (key === "tab" && tabs.length > 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
				// 标签页用 Tab / Shift+Tab 循环，焦点留在搜索框。
				event.preventDefault();
				const ids = tabs.map((tab) => tab.id);
				setTabId(moveSelection(ids, activeTabId, event.shiftKey ? -1 : 1) ?? ALL_TAB_ID);
				return;
			}
			if (ctrl && key === "x") {
				event.preventDefault();
				const view = effectiveSelectedId ? viewById.get(effectiveSelectedId) : undefined;
				if (view) deleteView(view);
				return;
			}
			if (ctrl && key === "k") {
				event.preventDefault();
				openMenuFor(effectiveSelectedId);
			}
			return;
		}
		if (step === "menu") {
			if (key === "escape" || key === "arrowleft" || (ctrl && key === "k")) {
				event.preventDefault();
				goBack();
				return;
			}
			if (key === "arrowdown" || key === "arrowup") {
				event.preventDefault();
				setMenuActiveId(moveSelection(menuIds, effectiveMenuActiveId, key === "arrowdown" ? 1 : -1));
				return;
			}
			if (key === "enter" && effectiveMenuActiveId) {
				event.preventDefault();
				selectMenuItem(effectiveMenuActiveId);
				return;
			}
			if (ctrl && key === "x") {
				event.preventDefault();
				if (targetView) {
					deleteView(targetView);
					backToList();
				}
			}
			return;
		}
		if (key === "escape") {
			event.preventDefault();
			goBack();
		}
	};
	useEffect(() => {
		if (!open) return;
		const listener = (event: KeyboardEvent): void => keyHandlerRef.current(event);
		window.addEventListener("keydown", listener, true);
		return () => window.removeEventListener("keydown", listener, true);
	}, [open]);

	return {
		open,
		step,
		modifierLabel: MODIFIER_LABEL,
		onClose: close,
		labels: {
			title: t("manageSessions.title"),
			searchPlaceholder: t("manageSessions.searchPlaceholder"),
			searchLabel: t("manageSessions.searchLabel"),
			empty: sessionsLoading
				? t("manageSessions.loading")
				: tabViews.length === 0 && !query.trim() && activeTabId === ALL_TAB_ID
					? t("manageSessions.emptyAll")
					: t("manageSessions.emptyQuery"),
			back: t("addProjectSplash.back"),
			renamePlaceholder: t("manageSessions.renamePlaceholder"),
			renameLabel: t("contextMenu.rename"),
			clearAll: t("manageSessions.clearAll"),
			clearAllDisabled: t("contextMenu.clearConversationDisabled"),
			hintDelete: t("manageSessions.hintDelete"),
			hintMore: t("manageSessions.hintMore"),
			hintTab: t("manageSessions.hintTab"),
			hintClose: t("addProjectSplash.hintClose"),
			hintBack: t("addProjectSplash.hintBack"),
			hintSelect: t("addProjectSplash.hintSelect"),
			hintRename: t("manageSessions.hintRename"),
		},
		tabs,
		activeTabId,
		onSelectTab: setTabId,
		query,
		onQueryChange: setQuery,
		rows,
		selectedId: effectiveSelectedId,
		onHoverRow: setSelectedId,
		onOpenRow: openRow,
		onMoreRow: moreRow,
		clearAllVisible: views.length > 0,
		clearAllDisabled: runningInScope,
		clearAllDisabledReason: t("contextMenu.clearConversationDisabled"),
		onClearAll: clearAll,
		menuTitle: menuKind === "tags" ? t("manageSessions.moveToTag") : (targetView?.label ?? ""),
		menuItems,
		menuActiveId: effectiveMenuActiveId,
		onHoverMenuItem: setMenuActiveId,
		onSelectMenuItem: selectMenuItem,
		renameValue,
		onRenameChange: setRenameValue,
		onRenameSubmit: submitRename,
		onBack: goBack,
	};
}
