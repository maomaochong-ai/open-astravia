import { useEffect, useState } from "react";

// 低于此宽度判定为「窄屏」：侧边栏从挤压布局切换为悬浮覆盖。
// 估算依据：侧边栏默认 220 + 间距/内边距 ~28 + 主内容最小 320 ≈ 568，留余量取 640。
export const SIDEBAR_NARROW_BREAKPOINT = 640;

/** 监听窗口宽度，返回是否窄于指定阈值（默认 {@link SIDEBAR_NARROW_BREAKPOINT}）。 */
export function useNarrowScreen(breakpoint: number = SIDEBAR_NARROW_BREAKPOINT): boolean {
	const [narrow, setNarrow] = useState(() => window.innerWidth < breakpoint);
	useEffect(() => {
		const onResize = (): void => setNarrow(window.innerWidth < breakpoint);
		onResize();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [breakpoint]);
	return narrow;
}

/** 监听窗口宽度，返回当前 `window.innerWidth`（像素）。 */
export function useWindowWidth(): number {
	const [width, setWidth] = useState(() => window.innerWidth);
	useEffect(() => {
		const onResize = (): void => setWidth(window.innerWidth);
		onResize();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);
	return width;
}
