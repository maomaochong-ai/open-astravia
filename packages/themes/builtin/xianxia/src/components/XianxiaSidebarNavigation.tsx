import {
	type NavIndicatorBounds,
	SidebarNavigation,
	type SidebarNavigationProps,
	type SidebarNavItem,
} from "@vetta/desktop-theme-ui/sidebar";
import { useThemePagesModel } from "@vetta/theme-sdk/pages";
import type { JSX } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * 相对 `<nav>` 容器测量，而不是 `offsetLeft/offsetTop`：导航项为了承载拖拽落位
 * 指示线被包了一层定位元素，`offsetParent` 因此不再是 `<nav>`。与宿主
 * `useSidebarModel` 的实现保持一致。
 */
function getNavIndicatorBounds(element: HTMLButtonElement): NavIndicatorBounds {
	const container = element.closest("nav");
	const rect = element.getBoundingClientRect();
	if (!container) {
		return { height: rect.height, left: element.offsetLeft, top: element.offsetTop, width: rect.width };
	}
	const containerRect = container.getBoundingClientRect();
	return {
		height: rect.height,
		left: rect.left - containerRect.left,
		top: rect.top - containerRect.top,
		width: rect.width,
	};
}

export function XianxiaSidebarNavigation(props: SidebarNavigationProps): JSX.Element {
	const themePages = useThemePagesModel();
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const moreButtonRef = useRef<HTMLButtonElement | null>(null);
	const themePageItems = useMemo<SidebarNavItem[]>(
		() =>
			themePages.navItems.map((item) => ({
				active: item.active,
				icon: item.icon ?? "icon-[solar--stars-linear]",
				key: item.key,
				label: item.label,
				title: item.label,
				type: "custom",
			})),
		[themePages.navItems],
	);
	const items = useMemo(
		() => [...props.items, ...themePageItems],
		[props.items, themePageItems],
	);
	const moreItems = props.moreItems ?? [];
	const moreActive = moreItems.some((item) => item.active);
	const activeMoreKey = moreItems.find((item) => item.active)?.key;
	const activeIndex = items.findIndex((item) => item.active);
	const [indicatorBounds, setIndicatorBounds] = useState<NavIndicatorBounds | null>(null);
	const setItemRef = useCallback(
		(index: number) => (element: HTMLButtonElement | null) => {
			itemRefs.current[index] = element;
			// 仅把宿主主区域项的 ref 回传（主题页追加项 index 超出宿主列表）。
			if (index < props.items.length) {
				props.setItemRef(index)(element);
			}
		},
		[props],
	);
	const setMoreButtonRef = useCallback(
		(element: HTMLButtonElement | null) => {
			moreButtonRef.current = element;
			props.setMoreButtonRef?.(element);
		},
		[props],
	);

	useLayoutEffect(() => {
		void props.moreOpen;
		void activeMoreKey;
		// items 变化（pin / unpin / 重排）会改变纵向位置，而 activeIndex 在「重排的
		// 是非选中项」时并不变化。
		void items;
		const activeElement = moreActive ? moreButtonRef.current : itemRefs.current[activeIndex];
		if (!activeElement) {
			setIndicatorBounds(null);
			return;
		}
		setIndicatorBounds(getNavIndicatorBounds(activeElement));
	}, [activeIndex, activeMoreKey, items, moreActive, props.moreOpen]);

	return (
		<SidebarNavigation
			{...props}
			indicatorBounds={indicatorBounds}
			items={items}
			moreActive={moreActive}
			onItemClick={(item) => {
				const page = themePages.navItems.find((navItem) => navItem.key === item.key);
				if (page) {
					themePages.actions.openPage(page.pageId);
					return;
				}
				props.onItemClick(item);
			}}
			setItemRef={setItemRef}
			setMoreButtonRef={setMoreButtonRef}
		/>
	);
}
