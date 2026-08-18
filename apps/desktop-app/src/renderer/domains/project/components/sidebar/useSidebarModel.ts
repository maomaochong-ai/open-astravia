import { desktopHostedRouteService } from "@shared/hosted-routes/hosted-route-service";
import {
	pluginWorkspaceViewsAtom,
	SIDEBAR_WIDTH_STORAGE_KEY,
	sidebarFilterAtom,
	sidebarWidthAtom,
} from "@shared/store/atoms";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { pluginWorkspaceRoute } from "../../../plugins/runtime/plugin-hosted-route-capability";
import { usePluginTextResolver } from "../../../plugins/runtime/plugin-i18n";
import {
	sortWorkspaceViews,
	workspaceViewNavKey,
	workspaceViewPath,
} from "../../../plugins/runtime/workspace-view-registry";
import { useNewChatNavigation } from "../../hooks/useNewChatNavigation";
import { toSidebarNavBadge } from "./sidebar-nav-badge";
import {
	canPinMore as canPinMoreKeys,
	moveNavKeyToRegion,
	NEW_SESSION_NAV_KEY,
	parseSidebarNavLayout,
	pinNavKey,
	reorderNavKeys,
	resolveSidebarNavLayout,
	SIDEBAR_NAV_LAYOUT_STORAGE_KEY,
	type SidebarNavLayout,
	toStoredSidebarNavLayout,
	unpinNavKey,
} from "./sidebar-nav-layout";
import type { NavIndicatorBounds, SidebarModel, SidebarNavBadge, SidebarNavItem, SidebarProps } from "./types";

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;

// label 在渲染期由 t(labelKey) 解析（模块级常量不存中文，见 AGENTS.md i18n 规范）。
// 这里只声明「有哪些内置入口」，它们落在置顶区还是收纳区由用户布局决定
// （见 sidebar-nav-layout.ts）；DEFAULT_PINNED_NAV_KEYS 只是首次使用时的默认分区。
const BUILTIN_NAV_ITEMS = [
	{
		type: "new-session",
		labelKey: "sidebar.nav.newSession",
		icon: "icon-[solar--pen-new-square-linear]",
	},
	{
		type: "route",
		path: "/automation" as const,
		labelKey: "sidebar.nav.automation",
		icon: "icon-[solar--magic-stick-3-linear]",
	},
	{
		type: "route",
		path: "/knowledge" as const,
		labelKey: "sidebar.nav.knowledge",
		icon: "icon-[solar--library-linear]",
		badgeKey: "sidebar.nav.betaBadge",
	},
	{
		type: "route",
		path: "/abilities" as const,
		labelKey: "sidebar.nav.skills",
		icon: "icon-[solar--widget-5-linear]",
	},
	{
		type: "route",
		path: "/batch-tasks" as const,
		labelKey: "sidebar.nav.batchTasks",
		icon: "icon-[solar--clipboard-check-outline]",
	},
	{
		type: "route",
		path: "/scenes" as const,
		labelKey: "sidebar.nav.scenes",
		icon: "icon-[solar--clapperboard-open-linear]",
	},
	{
		type: "route",
		settingsTab: "models" as const,
		labelKey: "sidebar.nav.modelSettings",
		icon: "icon-[solar--cpu-bolt-linear]",
	},
	{
		type: "route",
		settingsTab: "context" as const,
		labelKey: "sidebar.nav.agentSettings",
		icon: "icon-[solar--user-speak-rounded-linear]",
	},
	{
		type: "route",
		settingsTab: "appearance" as const,
		labelKey: "sidebar.nav.appearance",
		icon: "icon-[solar--palette-linear]",
	},
] as const;

/**
 * 首次使用时的置顶区默认成员：只留「能力」和设计画廊，其余入口默认收纳。
 * 顺序由 navCatalog 决定（内置在前、插件视图在后），即「新会话 / 能力 / 设计」。
 */
const DEFAULT_PINNED_NAV_KEYS = ["/abilities", workspaceViewNavKey("vetta-ui-design", "gallery")];

function loadStoredNavLayout(): SidebarNavLayout {
	try {
		const raw = localStorage.getItem(SIDEBAR_NAV_LAYOUT_STORAGE_KEY);
		return parseSidebarNavLayout(raw ? (JSON.parse(raw) as unknown) : null);
	} catch {
		return parseSidebarNavLayout(null);
	}
}

function persistNavLayout(layout: SidebarNavLayout): void {
	try {
		localStorage.setItem(SIDEBAR_NAV_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
	} catch {
		// 隐私模式 / 配额不足：内存态仍可用，只是重启不保留。
	}
}

/**
 * 指示条坐标必须相对**导航容器**，不能用 `offsetLeft/offsetTop`：导航项为了承载
 * 拖拽落位指示线被包了一层定位元素，`offsetParent` 因此不再是 `<nav>`，直接读
 * offset 会得到相对包裹层的 0 而把指示条钉在左上角。改用两者的 rect 差值，与
 * DOM 层级无关。
 */
function getNavIndicatorBounds(element: HTMLButtonElement): NavIndicatorBounds {
	const container = element.closest("nav");
	const rect = element.getBoundingClientRect();
	if (!container) {
		return { left: element.offsetLeft, top: element.offsetTop, width: rect.width, height: rect.height };
	}
	const containerRect = container.getBoundingClientRect();
	return {
		left: rect.left - containerRect.left,
		top: rect.top - containerRect.top,
		width: rect.width,
		height: rect.height,
	};
}

function isRouteActive(path: string, currentPath: string): boolean {
	// 子路径（知识库详情、能力旧详情深链）仍算父入口高亮。
	if (path === "/knowledge" || path === "/abilities") {
		return currentPath === path || currentPath.startsWith(`${path}/`);
	}
	return currentPath === path;
}

function toNavItem(
	item: (typeof BUILTIN_NAV_ITEMS)[number],
	label: string,
	currentPath: string,
	badge?: SidebarNavBadge,
): SidebarNavItem {
	if ("settingsTab" in item) {
		return {
			key: `/settings/${item.settingsTab}`,
			type: item.type,
			settingsTab: item.settingsTab,
			label,
			labelKey: item.labelKey,
			icon: item.icon,
			active: currentPath === `/settings/${item.settingsTab}`,
		};
	}
	if (item.type === "new-session") {
		return {
			key: NEW_SESSION_NAV_KEY,
			type: item.type,
			label,
			labelKey: item.labelKey,
			icon: item.icon,
			active: false,
			title: label,
			titleLabelKey: item.labelKey,
			locked: true,
		};
	}
	return {
		key: item.path,
		type: item.type,
		path: item.path,
		label,
		labelKey: item.labelKey,
		icon: item.icon,
		badge,
		active: isRouteActive(item.path, currentPath),
	};
}

/** 插件工作区视图 → 侧边栏导航项（key 与路由都由 workspace-view-registry 给出）。 */
function toWorkspaceNavItem(
	view: { pluginId: string; viewId: string; icon?: string; description?: string },
	label: string,
	pluginName: string,
	currentPath: string,
	badge?: SidebarNavBadge,
): SidebarNavItem {
	const path = workspaceViewPath(view.pluginId, view.viewId);
	return {
		key: workspaceViewNavKey(view.pluginId, view.viewId),
		type: "custom",
		label,
		icon: view.icon ?? "icon-[solar--widget-2-linear]",
		active: currentPath === path,
		title: view.description ? `${label} · ${view.description}` : `${label} · ${pluginName}`,
		badge,
		workspaceView: { pluginId: view.pluginId, viewId: view.viewId },
	};
}

export function useSidebarModel({
	onCollapse,
	floating = false,
}: Pick<SidebarProps, "onCollapse" | "floating">): SidebarModel {
	const { t } = useTranslation("project");
	const filter = useAtomValue(sidebarFilterAtom);
	const navigate = useNavigate();
	const matches = useMatches();
	const lastMatch = matches[matches.length - 1];
	const currentPath = lastMatch?.pathname ?? "/";
	const navItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const moreButtonRef = useRef<HTMLButtonElement | null>(null);
	const [navIndicatorBounds, setNavIndicatorBounds] = useState<NavIndicatorBounds | null>(null);
	const [moreOpen, setMoreOpen] = useState(false);

	const onNewChat = useNewChatNavigation();
	const [width, setWidth] = useAtom(sidebarWidthAtom);
	const widthRef = useRef(width);
	widthRef.current = width;
	// Resolve i18n in the model layer so theme-ui nav item stays props-driven.
	const workspaceViews = useAtomValue(pluginWorkspaceViewsAtom);
	const resolvePluginText = usePluginTextResolver();
	/** 全部可用导航项（内置 + 插件工作区视图），按 key 索引；布局只存 key。 */
	const navCatalog: SidebarNavItem[] = useMemo(
		() => [
			...BUILTIN_NAV_ITEMS.map((item) =>
				toNavItem(
					item,
					t(item.labelKey),
					currentPath,
					"badgeKey" in item ? { kind: "text", text: t(item.badgeKey) } : undefined,
				),
			),
			...sortWorkspaceViews(workspaceViews).map((view) =>
				toWorkspaceNavItem(
					view,
					resolvePluginText(view.pluginId, view.label),
					view.pluginName,
					currentPath,
					toSidebarNavBadge(
						view.badge,
						(raw) => resolvePluginText(view.pluginId, raw),
						t("sidebar.nav.betaBadge"),
					),
				),
			),
		],
		[currentPath, resolvePluginText, t, workspaceViews],
	);

	const [storedLayout, setStoredLayout] = useState<SidebarNavLayout>(loadStoredNavLayout);
	const resolvedLayout = useMemo(
		() =>
			resolveSidebarNavLayout(
				navCatalog.map((item) => item.key),
				storedLayout,
				DEFAULT_PINNED_NAV_KEYS,
			),
		[navCatalog, storedLayout],
	);
	const commitLayout = useCallback((next: ReturnType<typeof resolveSidebarNavLayout>) => {
		const stored = toStoredSidebarNavLayout(next);
		setStoredLayout(stored);
		persistNavLayout(stored);
	}, []);

	const itemsByKey = useMemo(() => new Map(navCatalog.map((item) => [item.key, item])), [navCatalog]);
	const navItems: SidebarNavItem[] = useMemo(
		() =>
			resolvedLayout.pinned
				.map((key) => itemsByKey.get(key))
				.filter((item): item is SidebarNavItem => item !== undefined)
				.map((item) => ({ ...item, pinned: true })),
		[itemsByKey, resolvedLayout],
	);
	const moreNavItems: SidebarNavItem[] = useMemo(
		() =>
			resolvedLayout.more
				.map((key) => itemsByKey.get(key))
				.filter((item): item is SidebarNavItem => item !== undefined)
				.map((item) => ({ ...item, pinned: false })),
		[itemsByKey, resolvedLayout],
	);

	const pinNavItem = useCallback(
		(key: string) => commitLayout(pinNavKey(resolvedLayout, key)),
		[commitLayout, resolvedLayout],
	);
	const unpinNavItem = useCallback(
		(key: string) => commitLayout(unpinNavKey(resolvedLayout, key)),
		[commitLayout, resolvedLayout],
	);
	const moveNavItem = useCallback(
		(key: string, region: "pinned" | "more", beforeKey: string | null) => {
			const sameRegion =
				region === "pinned" ? resolvedLayout.pinned.includes(key) : resolvedLayout.more.includes(key);
			commitLayout(
				sameRegion
					? reorderNavKeys(resolvedLayout, region, key, beforeKey)
					: moveNavKeyToRegion(resolvedLayout, key, region, beforeKey),
			);
		},
		[commitLayout, resolvedLayout],
	);
	const resetNavLayout = useCallback(() => {
		setStoredLayout({ pinned: [], more: [] });
		persistNavLayout({ pinned: [], more: [] });
	}, []);

	const moreLabel = t("sidebar.nav.more");
	const moreActive = moreNavItems.some((item) => item.active);
	// 收纳项切换时触发器 label 变宽，需重测指示条。
	const activeMoreKey = moreNavItems.find((item) => item.active)?.key;
	const activeNavIndex = navItems.findIndex((item) => item.active);

	useLayoutEffect(() => {
		// width / moreOpen / activeMoreKey 变化会影响 full-width nav button 的测量结果。
		// navItems 也要跟：pin / unpin / 重排会改变置顶项与「更多」触发器的纵向位置，
		// 而 activeNavIndex 在「重排的是非选中项」时并不变化。
		void width;
		void moreOpen;
		void activeMoreKey;
		void navItems;
		const activeElement = moreActive ? moreButtonRef.current : navItemRefs.current[activeNavIndex];
		if (!activeElement) {
			setNavIndicatorBounds(null);
			return;
		}
		setNavIndicatorBounds(getNavIndicatorBounds(activeElement));
	}, [activeMoreKey, activeNavIndex, moreActive, moreOpen, navItems, width]);

	const [imOnline, setImOnline] = useState(false);

	useEffect(() => {
		let cancelled = false;
		let unsub: (() => void) | null = null;
		void (async () => {
			try {
				const unsubFn = await window.vetta.im.subscribeStatus(
					(s) => setImOnline(s.transport === "online" || s.transport === "connecting"),
					() => {},
				);
				if (cancelled) {
					unsubFn();
					return;
				}
				unsub = unsubFn;
				// Initial push from subscribeStatus races with our listener
				// attachment, so fetch once explicitly to seed state.
				const current = await window.vetta.im.getStatus();
				if (!cancelled) setImOnline(current.transport === "online" || current.transport === "connecting");
			} catch {
				// ignore; badge stays hidden
			}
		})();
		return () => {
			cancelled = true;
			unsub?.();
		};
	}, []);

	const openClawSettings = useCallback(() => {
		void navigate({ to: "/settings/$tab", params: { tab: "im" } });
	}, [navigate]);

	const resize = useCallback(
		(delta: number) => {
			setWidth((w) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w + delta)));
		},
		[setWidth],
	);
	const resizeEnd = useCallback(() => {
		localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(widthRef.current));
	}, []);
	const setNavItemRef = useCallback(
		(index: number) => (element: HTMLButtonElement | null) => {
			navItemRefs.current[index] = element;
		},
		[],
	);
	const setMoreButtonRef = useCallback((element: HTMLButtonElement | null) => {
		moreButtonRef.current = element;
	}, []);
	const openNavItem = useCallback(
		(item: SidebarNavItem) => {
			if (item.type === "new-session") {
				onNewChat();
				return;
			}
			if (item.workspaceView) {
				void desktopHostedRouteService.open(
					pluginWorkspaceRoute(item.workspaceView.pluginId, item.workspaceView.viewId),
				);
				return;
			}
			if (item.settingsTab) {
				void navigate({ to: "/settings/$tab", params: { tab: item.settingsTab } });
				return;
			}
			if (item.path) void navigate({ to: item.path });
		},
		[navigate, onNewChat],
	);

	return {
		width,
		floating,
		filter,
		navItems,
		moreNavItems,
		moreLabel,
		moreOpen,
		moreActive,
		canPinMore: canPinMoreKeys(resolvedLayout),
		navIndicatorBounds,
		imOnline,
		setNavItemRef,
		setMoreButtonRef,
		actions: {
			openNavItem,
			openClawSettings,
			setMoreOpen,
			resize,
			resizeEnd,
			collapse: onCollapse,
			pinNavItem,
			unpinNavItem,
			moveNavItem,
			resetNavLayout,
		},
	};
}
