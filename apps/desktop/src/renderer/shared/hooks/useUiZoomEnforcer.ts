import { useEffect } from "react";
import { uiZoomNeedsCorrection } from "../../../shared/ui-zoom";

/** 窗口重新可见后 Chromium 可能稍后才把缩放改回去，所以延后再核对一次。 */
const RECHECK_DELAY_MS = 300;

/**
 * 保证页面实际缩放等于档位。窗口隐藏（Cmd+W）再唤起后，Chromium 会把实际缩放改回陈旧值，
 * 而主进程毫不知情，结果设置里显示 110% 画面却不是。这里在渲染进程里直接读真实缩放
 * （webFrame），挂载、档位变化、重新可见、重新获得焦点时核对，不一致就纠正。
 */
export function useUiZoomEnforcer(factor: number, enabled: boolean): void {
	useEffect(() => {
		if (!enabled) return;
		const check = () => {
			const api = window.astravia.uiZoom;
			if (uiZoomNeedsCorrection(api.getActualZoom(), factor)) api.applyZoom(factor);
		};
		let timer: ReturnType<typeof setTimeout> | undefined;
		const checkNowAndLater = () => {
			check();
			clearTimeout(timer);
			timer = setTimeout(check, RECHECK_DELAY_MS);
		};
		const onVisibility = () => {
			if (document.visibilityState === "visible") checkNowAndLater();
		};
		check();
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("focus", checkNowAndLater);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("focus", checkNowAndLater);
		};
	}, [factor, enabled]);
}
