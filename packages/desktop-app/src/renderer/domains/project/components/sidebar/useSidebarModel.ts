import {
	activeSessionAtom,
	conversationBucketCwd,
	defaultConversationCwdAtom,
	SIDEBAR_WIDTH_STORAGE_KEY,
	sidebarFilterAtom,
	sidebarWidthAtom,
} from "@shared/store/atoms";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NavIndicatorBounds, SidebarModel, SidebarNavItem, SidebarProps } from "./types";

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;

// label 在渲染期由 t(labelKey) 解析（模块级常量不存中文，见 AGENTS.md i18n 规范）。
// 主区域常驻：新会话 / 自动化 / 知识库 / 能力。
const PRIMARY_NAV_ITEMS = [
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
] as const;

// 「更多」收纳：批量任务 + 常用设置直达。插件已并入能力页（ADR-0049），不再有独立入口。
const MORE_NAV_ITEMS = [
	{
		type: "route",
		path: "/batch-tasks" as const,
		labelKey: "sidebar.nav.batchTasks",
		icon: "icon-[solar--clipboard-check-outline]",
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

function getNavIndicatorBounds(element: HTMLButtonElement): NavIndicatorBounds {
	return {
		left: element.offsetLeft,
		top: element.offsetTop,
		width: element.offsetWidth,
		height: element.offsetHeight,
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
	item: (typeof PRIMARY_NAV_ITEMS)[number] | (typeof MORE_NAV_ITEMS)[number],
	label: string,
	currentPath: string,
	badge?: string,
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
			key: item.type,
			type: item.type,
			label,
			labelKey: item.labelKey,
			icon: item.icon,
			active: false,
			title: label,
			titleLabelKey: item.labelKey,
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
	const activeSession = useAtomValue(activeSessionAtom);
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);
	const setDefaultConversationCwd = useSetAtom(defaultConversationCwdAtom);
	const navItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const moreButtonRef = useRef<HTMLButtonElement | null>(null);
	const [navIndicatorBounds, setNavIndicatorBounds] = useState<NavIndicatorBounds | null>(null);
	const [moreOpen, setMoreOpen] = useState(false);

	// 「新会话」按钮目标 cwd 解析顺序：
	//   1. 当前路由参数 cwd（/project/$cwd 或 /new-session/$cwd）—— 项目详情聚焦
	//   2. 仅在聊天页（/）时，跟随 activeSession 的 cwd —— 聚焦的是「某项目的会话」时落到该项目。
	//      ADR-0007：默认「对话」session 的运行 cwd 是默认项目根下的 per-session 子目录，
	//      必须归一回项目根，否则新会话会挂到子目录 bucket、不在「会话」列表出现。
	//   3. 其余一切场景（自动化/批量任务/Claw 查看器/设置等）落到默认「会话」项目，
	//      不能沿用残留的 activeSession.cwd，否则会把新会话建到上一个项目里。
	const newChatCwd = (() => {
		const params = lastMatch?.params as { cwd?: string } | undefined;
		if (params?.cwd) {
			try {
				return decodeURIComponent(params.cwd);
			} catch {
				return params.cwd;
			}
		}
		if (currentPath === "/" && activeSession?.cwd) {
			return conversationBucketCwd(activeSession.cwd, defaultConversationCwd);
		}
		return defaultConversationCwd || "";
	})();
	const onNewChat = useCallback(() => {
		void (async () => {
			let targetCwd = newChatCwd;
			if (!targetCwd) {
				try {
					const config = await window.vetta.config.get();
					targetCwd = config.defaultConversationCwd ?? "";
					if (targetCwd) setDefaultConversationCwd(targetCwd);
				} catch (error) {
					console.error("[Sidebar] failed to resolve default conversation cwd", error);
				}
			}
			if (!targetCwd) return;
			void navigate({
				to: "/new-session/$cwd",
				params: { cwd: encodeURIComponent(targetCwd) },
			});
		})();
	}, [navigate, newChatCwd, setDefaultConversationCwd]);
	const [width, setWidth] = useAtom(sidebarWidthAtom);
	const widthRef = useRef(width);
	widthRef.current = width;
	// Resolve i18n in the model layer so theme-ui nav item stays props-driven.
	const navItems: SidebarNavItem[] = useMemo(
		() =>
			PRIMARY_NAV_ITEMS.map((item) =>
				toNavItem(item, t(item.labelKey), currentPath, "badgeKey" in item ? t(item.badgeKey) : undefined),
			),
		[currentPath, t],
	);
	const moreNavItems: SidebarNavItem[] = useMemo(
		() => MORE_NAV_ITEMS.map((item) => toNavItem(item, t(item.labelKey), currentPath)),
		[currentPath, t],
	);
	const moreLabel = t("sidebar.nav.more");
	const moreActive = moreNavItems.some((item) => item.active);
	// 收纳项切换时触发器 label 变宽，需重测指示条。
	const activeMoreKey = moreNavItems.find((item) => item.active)?.key;
	const activeNavIndex = navItems.findIndex((item) => item.active);

	useLayoutEffect(() => {
		// width / moreOpen / activeMoreKey 变化会影响 full-width nav button 的测量结果。
		void width;
		void moreOpen;
		void activeMoreKey;
		const activeElement = moreActive ? moreButtonRef.current : navItemRefs.current[activeNavIndex];
		if (!activeElement) {
			setNavIndicatorBounds(null);
			return;
		}
		setNavIndicatorBounds(getNavIndicatorBounds(activeElement));
	}, [activeMoreKey, activeNavIndex, moreActive, moreOpen, width]);

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
		},
	};
}
