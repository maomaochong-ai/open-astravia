import type { InstalledPlugin, SkillInfo } from "@preload/api";
import { PLUGIN_HOSTED_ROUTE_PATH } from "@shared/hosted-routes/hosted-route-descriptors";
import { isMac, isWindows } from "@shared/lib/platform";
import { getEffectiveShortcut, loadShortcutBindings } from "@shared/lib/shortcuts";
import { useShortcutScope } from "@shared/shortcuts";
import {
	commandMenuOpenAtom,
	isPersonalModeAtom,
	pluginWorkspaceViewsAtom,
	projectsAtom,
	type SessionExecutionMode,
} from "@shared/store/atoms";
import { authUserAtom } from "@shared/store/auth-atoms";
import { useNavigate } from "@tanstack/react-router";
import type { CommandMenuGroupView, CommandMenuViewLabels } from "@vetta/theme-ui/overlays";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveDesktopSessionOpenTarget } from "@/shared/session-access";
import { usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import { useSessionSearch } from "../../project/hooks/useSessionSearch";
import { buildCommandMenuGroups, type CommandMenuGroupLabels } from "../lib/build-groups";
import { tokenizeCommandMenuQuery } from "../lib/match";
import {
	buildInstalledAbilityEntries,
	buildMarketplaceEscapeEntry,
	buildProjectEntries,
	buildSessionEntries,
	buildSettingsEntries,
	buildWorkspaceViewEntries,
	type CommandMenuSourceLabels,
} from "../lib/sources";
import type { CommandMenuAction, CommandMenuEntry } from "../types";

/** 会话组一次最多渲染几条；后端结果远多于此，截断在进 React 之前完成。 */
const SESSION_RESULT_LIMIT = 12;

const OPEN_COMMAND_MENU_ACTION = "open-command-menu";
const OPEN_COMMAND_MENU_DEFAULT_KEY = "mod+k";

/**
 * 面板内用来「再按一次关闭」的组合键。必须读生效绑定而不是写死 mod+k：
 * 这个动作在设置里可改键，写死会导致改键后旧键仍能关、新键反而无效。
 * 只在面板打开过之后才去读配置，避免为一个常驻组件在启动路径上多一次 IPC。
 */
function useCommandMenuToggleKey(enabled: boolean): string {
	const [key, setKey] = useState(OPEN_COMMAND_MENU_DEFAULT_KEY);
	useEffect(() => {
		if (!enabled) return;
		let active = true;
		const apply = (bindings: Parameters<typeof getEffectiveShortcut>[1]) => {
			if (!active) return;
			setKey(getEffectiveShortcut(OPEN_COMMAND_MENU_ACTION, bindings) || OPEN_COMMAND_MENU_DEFAULT_KEY);
		};
		void loadShortcutBindings().then(apply);
		const unsubscribe = window.vetta.config.onShortcutsChanged((event) => apply(event.bindings ?? {}));
		return () => {
			active = false;
			unsubscribe();
		};
	}, [enabled]);
	return key;
}

export interface CommandMenuModel {
	readonly open: boolean;
	readonly query: string;
	readonly groups: readonly CommandMenuGroupView[];
	readonly selectedId: string | null;
	readonly labels: CommandMenuViewLabels;
	readonly suppressSelectionAnimation: boolean;
	readonly onQueryChange: (value: string) => void;
	readonly onHoverItem: (id: string) => void;
	readonly onActivateItem: (id: string) => void;
	readonly onClose: () => void;
}

/**
 * 已装能力的目录。刻意**不在面板打开时就取**，而是等到第一次有查询词：
 * 空查询态下不产生任何 IPC 是既定约束，而这两个调用虽然是本地的，也没必要
 * 为一次「按了 ⌘K 又按 esc」付出代价。取到后在本次打开期间缓存。
 */
function useInstalledAbilities(enabled: boolean): {
	data: { skills: SkillInfo[]; plugins: InstalledPlugin[] };
	loading: boolean;
} {
	const [data, setData] = useState<{ skills: SkillInfo[]; plugins: InstalledPlugin[] }>({
		skills: [],
		plugins: [],
	});
	const [loading, setLoading] = useState(false);
	const loadedRef = useRef(false);

	useEffect(() => {
		if (!enabled || loadedRef.current) return;
		loadedRef.current = true;
		let active = true;
		setLoading(true);
		void Promise.all([window.vetta.skills.list(), window.vetta.plugins.listAll()])
			.then(([skills, plugins]) => {
				if (active) setData({ skills, plugins });
			})
			.catch(() => {
				// 能力目录取不到不该让整个面板失效：其余四源照常可用。
				if (active) setData({ skills: [], plugins: [] });
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [enabled]);

	return { data, loading };
}

export interface UseCommandMenuModelArgs {
	readonly onOpenSession: (cwd: string, sessionPath?: string, executionMode?: SessionExecutionMode) => Promise<void>;
}

export function useCommandMenuModel({ onOpenSession }: UseCommandMenuModelArgs): CommandMenuModel {
	const { t } = useTranslation("common");
	const { t: tSettings } = useTranslation("settings");
	const navigate = useNavigate();

	const [open, setOpen] = useAtom(commandMenuOpenAtom);
	const [query, setQuery] = useState("");
	// 输入框永远跟手：匹配与重排跑在延迟值上，击键本身只更新受控 input。
	const deferredQuery = useDeferredValue(query);

	const projects = useAtomValue(projectsAtom);
	const workspaceViews = useAtomValue(pluginWorkspaceViewsAtom);
	const isPersonal = useAtomValue(isPersonalModeAtom);
	const authUser = useAtomValue(authUserAtom);
	const resolvePluginText = usePluginTextResolver();

	const toggleKey = useCommandMenuToggleKey(open);
	const hasQuery = Boolean(deferredQuery.trim());
	const abilities = useInstalledAbilities(open && hasQuery);

	// 会话是唯一的异步源：空查询时后端只回一份 sources 就 done，故不必发起。
	const sessionSearch = useSessionSearch(open && hasQuery, {
		query: deferredQuery,
		limit: SESSION_RESULT_LIMIT,
	});

	const sourceLabels = useMemo<CommandMenuSourceLabels>(
		() => ({
			sessionTypes: {
				conversation: t("commandMenu.sessionTypes.conversation"),
				claw: t("commandMenu.sessionTypes.claw"),
				project: t("commandMenu.sessionTypes.project"),
				batch: t("commandMenu.sessionTypes.batch"),
			},
			sessionUnavailable: t("commandMenu.sessionUnavailable"),
			settingsGroupHint: t("commandMenu.groups.settings"),
			abilitySkill: t("commandMenu.badges.skill"),
			abilityScene: t("commandMenu.badges.scene"),
			abilityPlugin: t("commandMenu.badges.plugin"),
			searchMarketplace: t("commandMenu.searchMarketplace"),
		}),
		[t],
	);

	const groupLabels = useMemo<CommandMenuGroupLabels>(
		() => ({
			groups: {
				projects: t("commandMenu.groups.projects"),
				sessions: t("commandMenu.groups.sessions"),
				abilities: t("commandMenu.groups.abilities"),
				settings: t("commandMenu.groups.settings"),
				workspaceViews: t("commandMenu.groups.workspaceViews"),
			},
			overflow: (count: number) => t("commandMenu.overflow", { count }),
		}),
		[t],
	);

	// 目录只跟着源数据重建，击键不会重跑它——这是击键路径上最大的一块成本。
	const staticEntries = useMemo<CommandMenuEntry[]>(
		() => [
			...buildProjectEntries(projects),
			...buildSettingsEntries({ isPersonal, hasAuthUser: Boolean(authUser), isMac, isWindows }, (key) =>
				tSettings(key),
			),
			...buildWorkspaceViewEntries(workspaceViews, (view) => resolvePluginText(view.pluginId, view.label)),
		],
		[projects, workspaceViews, isPersonal, authUser, tSettings, resolvePluginText],
	);

	const abilityEntries = useMemo(
		() => buildInstalledAbilityEntries(abilities.data, sourceLabels),
		[abilities.data, sourceLabels],
	);

	const sessionEntries = useMemo(
		() => buildSessionEntries(sessionSearch.results.slice(0, SESSION_RESULT_LIMIT), sourceLabels),
		[sessionSearch.results, sourceLabels],
	);

	const entries = useMemo<CommandMenuEntry[]>(() => {
		const all = [...staticEntries, ...abilityEntries, ...sessionEntries];
		// 逃生行只在有查询词时出现：空态里它没有可携带的搜索词，等于一条噪音。
		return hasQuery ? [...all, buildMarketplaceEscapeEntry(deferredQuery, sourceLabels)] : all;
	}, [staticEntries, abilityEntries, sessionEntries, hasQuery, deferredQuery, sourceLabels]);

	const tokens = useMemo(() => tokenizeCommandMenuQuery(deferredQuery), [deferredQuery]);

	const { groups, orderedIds, entryById } = useMemo(
		() =>
			buildCommandMenuGroups({
				entries,
				tokens,
				labels: groupLabels,
				loadingGroups: sessionSearch.loading ? ["sessions"] : [],
			}),
		[entries, tokens, groupLabels, sessionSearch.loading],
	);

	const [selectedId, setSelectedId] = useState<string | null>(null);
	// 只有方向键移动才播指示条位移；结果重算导致的选中变化一律不播。
	const [suppressSelectionAnimation, setSuppressSelectionAnimation] = useState(true);

	/**
	 * 选中态锚在 id 上：异步会话结果到达会重排列表，若锚在下标，光标的视觉位置不动
	 * 但指向的条目会被换掉，回车打开的将是用户没看见的东西。id 还在就保持，
	 * 消失了才回落到第一条。
	 */
	useEffect(() => {
		setSelectedId((current) => {
			if (current && orderedIds.includes(current)) return current;
			return orderedIds[0] ?? null;
		});
	}, [orderedIds]);

	const close = useCallback(() => {
		setOpen(false);
		setQuery("");
		setSelectedId(null);
		setSuppressSelectionAnimation(true);
	}, [setOpen]);

	const runAction = useCallback(
		(action: CommandMenuAction) => {
			switch (action.kind) {
				case "openProject":
					void navigate({ to: "/project/$cwd", params: { cwd: encodeURIComponent(action.cwd) } });
					return true;
				case "openSettingsSection":
					void navigate({
						to: "/settings/$tab",
						params: { tab: action.tab },
						search: { section: action.section },
					});
					return true;
				case "openAbilities":
					void navigate({ to: "/abilities", search: action.query ? { q: action.query } : {} });
					return true;
				case "openWorkspaceView":
					void navigate({
						to: PLUGIN_HOSTED_ROUTE_PATH,
						params: { pluginId: action.pluginId, viewId: action.viewId },
					});
					return true;
				case "openSession": {
					const { result } = action;
					const target = resolveDesktopSessionOpenTarget(result.session.access);
					if (target === "viewer") {
						void navigate({
							to: "/viewer/$path",
							params: { path: encodeURIComponent(result.session.path) },
						});
						return true;
					}
					if (target === "interactive") {
						// batch 会话的落点是它自己的 cwd，其余取侧栏分桶的 sourceCwd。
						const cwd = result.sourceKind === "batch" ? result.session.cwd : result.sourceCwd;
						void onOpenSession(cwd, result.session.path, result.executionMode);
						return true;
					}
					return false;
				}
			}
		},
		[navigate, onOpenSession],
	);

	const activate = useCallback(
		(id: string) => {
			const entry = entryById.get(id);
			if (!entry || entry.disabled) return;
			if (runAction(entry.action)) close();
		},
		[entryById, runAction, close],
	);

	const move = useCallback(
		(delta: number) => {
			setSuppressSelectionAnimation(false);
			setSelectedId((current) => {
				if (orderedIds.length === 0) return null;
				const index = current ? orderedIds.indexOf(current) : -1;
				const next = (index + delta + orderedIds.length) % orderedIds.length;
				return orderedIds[next];
			});
		},
		[orderedIds],
	);

	const selectedIdRef = useRef(selectedId);
	selectedIdRef.current = selectedId;

	/**
	 * exclusive：面板打开期间未匹配的键不下沉到 app 层，否则在面板里敲 mod+n
	 * 会在背后新建会话。mod+k 显式绑成关闭——app 层那条是 `when: "always"`，
	 * 不在这里拦下就会被再次「打开」，表现为按了没反应；用的是生效绑定而非默认键。
	 */
	useShortcutScope({
		id: "overlay:command-menu",
		kind: "overlay",
		active: open,
		exclusive: true,
		bindings: useMemo(
			() => [
				{ key: "arrowdown", run: () => move(1) },
				{ key: "arrowup", run: () => move(-1) },
				{ key: "enter", run: () => selectedIdRef.current && activate(selectedIdRef.current) },
				{ key: "escape", run: () => close() },
				{ key: toggleKey, run: () => close() },
			],
			[move, activate, close, toggleKey],
		),
	});

	const onQueryChange = useCallback((value: string) => {
		setQuery(value);
		setSuppressSelectionAnimation(true);
	}, []);

	const onHoverItem = useCallback((id: string) => {
		setSuppressSelectionAnimation(false);
		setSelectedId(id);
	}, []);

	const labels = useMemo<CommandMenuViewLabels>(
		() => ({
			placeholder: t("commandMenu.placeholder"),
			empty: t("commandMenu.empty"),
			emptyHint: t("commandMenu.emptyHint"),
			loading: t("commandMenu.loading"),
			title: t("commandMenu.title"),
			hintNavigate: t("commandMenu.hintNavigate"),
			hintSelect: t("commandMenu.hintSelect"),
			hintClose: t("commandMenu.hintClose"),
		}),
		[t],
	);

	return {
		open,
		query,
		groups,
		selectedId,
		labels,
		suppressSelectionAnimation,
		onQueryChange,
		onHoverItem,
		onActivateItem: activate,
		onClose: close,
	};
}
