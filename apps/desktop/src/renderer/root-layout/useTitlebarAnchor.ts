import { useUiZoom } from "@shared/hooks/useUiZoom";
import { useEffect } from "react";
import { measureTitlebarCenter } from "./titlebar-anchor";

/**
 * 1. 把界面缩放写到 :root 的 `--ui-zoom`，让 theme-ui 里「给红绿灯留的让位」按屏幕像素换算。
 * 2. 实测页头图标中线并上报主进程；布局任何变化（侧边栏开合、沉浸式页头、窗口缩放）都会重新量。
 * `layoutKey` 变化代表页头形态可能变了，需要重新量一次。
 */
export function useTitlebarAnchor(layoutKey: string, fallbackCenter?: number): void {
	const { factor } = useUiZoom();

	useEffect(() => {
		document.documentElement.style.setProperty("--ui-zoom", String(factor));
	}, [factor]);

	// layoutKey 不在 effect 里读取，只用来在页头形态变化时重新量一次。
	// biome-ignore lint/correctness/useExhaustiveDependencies: layoutKey is an intentional re-measure trigger
	useEffect(() => {
		let frame: number | null = null;
		let last: number | undefined;
		const report = (): void => {
			frame = null;
			// 铺满态没有页头锚点可量，用调用方给的兜底中线，让红绿灯回到默认位置而不是停在旧值。
			const center = measureTitlebarCenter(document) ?? fallbackCenter;
			if (center === undefined || center === last) return;
			last = center;
			window.astravia.uiZoom.reportTitlebarCenter(center);
		};
		const schedule = (): void => {
			if (frame === null) frame = requestAnimationFrame(report);
		};
		schedule();
		const observer = new ResizeObserver(schedule);
		observer.observe(document.body);
		window.addEventListener("resize", schedule);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", schedule);
			if (frame !== null) cancelAnimationFrame(frame);
		};
	}, [factor, fallbackCenter, layoutKey]);
}
