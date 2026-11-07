import { type RefObject, useCallback, useEffect, useState } from "react";

export interface ActivityTabMaximizeModel {
	/** 面板是否已铺满内容区（只放大活动面板这一列，不是宿主窗口全屏）。 */
	isMaximized: boolean;
	/** 铺满时需要占用的宽度：内容行的实时宽度。 */
	width: number;
	toggle: () => void;
	exit: () => void;
}

/**
 * 活动面板的「铺满内容区」状态。
 *
 * 面板与消息列是同一 flex 行里的兄弟节点：面板这一列拿到整行宽度后，
 * 消息列自然被压到 0，不需要父级布局配合。宽度按内容行实测，所以窗口
 * 缩放、侧边栏折叠都不会把面板留在旧尺寸上。
 */
export function useActivityTabMaximize(hostRef: RefObject<HTMLElement | null>): ActivityTabMaximizeModel {
	const [isMaximized, setIsMaximized] = useState(false);
	const [width, setWidth] = useState(0);

	const exit = useCallback(() => setIsMaximized(false), []);
	const toggle = useCallback(() => setIsMaximized((previous) => !previous), []);

	useEffect(() => {
		if (!isMaximized) {
			setWidth(0);
			return;
		}
		const measure = (): void => {
			const row = hostRef.current?.parentElement;
			if (!row) return;
			const next = row.clientWidth;
			setWidth((previous) => (previous === next ? previous : next));
		};
		measure();
		const row = hostRef.current?.parentElement;
		if (!row || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(row);
		return () => observer.disconnect();
	}, [hostRef, isMaximized]);

	useEffect(() => {
		if (!isMaximized) return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") setIsMaximized(false);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [isMaximized]);

	return { isMaximized, width, toggle, exit };
}
