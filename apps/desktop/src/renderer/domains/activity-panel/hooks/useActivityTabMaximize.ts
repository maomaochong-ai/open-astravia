import { activityPanelFocusAtom } from "@shared/store/activity-atoms";
import { useAtom } from "jotai";
import { type RefObject, useCallback, useEffect, useState } from "react";

export interface ActivityTabMaximizeModel {
	/** 面板是否已铺满内容区，并让宿主侧边栏与全局顶栏让位（不是宿主窗口全屏）。 */
	isMaximized: boolean;
	/** 铺满时需要占用的宽度：内容行的实时宽度。 */
	width: number;
	toggle: () => void;
	exit: () => void;
}

/**
 * 活动面板的「铺满」状态。
 *
 * 面板与消息列是同一 flex 行里的兄弟节点：面板这一列拿到整行宽度后，
 * 消息列自然被压到 0，不需要父级布局配合。宽度按内容行实测，所以窗口
 * 缩放、侧边栏折叠都不会把面板留在旧尺寸上。
 *
 * 开关放在共享 atom 里而不是本地 state：铺满要同时收起宿主侧边栏和全局顶栏，
 * 那两处由根布局渲染，只有同一个状态源才能保证「面板铺满」和「外壳让位」同时发生。
 */
export function useActivityTabMaximize(hostRef: RefObject<HTMLElement | null>): ActivityTabMaximizeModel {
	const [isMaximized, setIsMaximized] = useAtom(activityPanelFocusAtom);
	const [width, setWidth] = useState(0);

	const exit = useCallback(() => setIsMaximized(false), [setIsMaximized]);
	const toggle = useCallback(() => setIsMaximized((previous) => !previous), [setIsMaximized]);

	useEffect(() => {
		if (!isMaximized) {
			setWidth(0);
			return;
		}
		const row = hostRef.current?.parentElement;
		if (!row) return;
		// 面板要贴住两侧：行里给消息列留的 flex 间隙会让面板左边缘浮起一条缝。
		// 先把这个间隙收掉再按整行宽度量；间隙为 0 时扣减量也是 0，测量与写入
		// 是同一个不动点，不会「量到旧宽度再弹一次」。退出时还原行内联样式。
		const previousGap = row.style.columnGap;
		row.style.columnGap = "0px";
		const measure = (): void => {
			const next = Math.max(0, Math.round(row.clientWidth));
			setWidth((previous) => (previous === next ? previous : next));
		};
		measure();
		if (typeof ResizeObserver === "undefined") {
			return () => {
				row.style.columnGap = previousGap;
			};
		}
		const observer = new ResizeObserver(measure);
		observer.observe(row);
		return () => {
			observer.disconnect();
			row.style.columnGap = previousGap;
		};
	}, [hostRef, isMaximized]);

	useEffect(() => {
		if (!isMaximized) return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") setIsMaximized(false);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [isMaximized, setIsMaximized]);

	// 卸载即退出：路由切走后不能把宿主留在「没有侧边栏和顶栏」的形态里。
	useEffect(() => {
		return () => setIsMaximized(false);
	}, [setIsMaximized]);

	return { isMaximized, width, toggle, exit };
}
