import { useCallback, useEffect, useState } from "react";
import { normalizeUiZoomFactor, UI_ZOOM_DEFAULT } from "../../../shared/ui-zoom";

/**
 * 主窗口界面缩放。比例的事实源在主进程（滑块与 Cmd +/- 都改它），这里只镜像：
 * 主进程广播（含快捷键触发）同步回来，本地只做乐观更新，避免松手后等一次 IPC 往返。
 */
export function useUiZoom(): { factor: number; setFactor: (value: number) => void; reset: () => void } {
	const [factor, setFactorState] = useState(UI_ZOOM_DEFAULT);

	useEffect(() => {
		let cancelled = false;
		void window.astravia.uiZoom.get().then((value) => {
			if (!cancelled) setFactorState(normalizeUiZoomFactor(value));
		});
		const off = window.astravia.uiZoom.onChanged((value) => setFactorState(normalizeUiZoomFactor(value)));
		return () => {
			cancelled = true;
			off();
		};
	}, []);

	const setFactor = useCallback((value: number) => {
		const next = normalizeUiZoomFactor(value);
		setFactorState(next);
		// 写入失败时以主进程广播为准：它带着当前实际比例，这里不吞掉也不回滚。
		void window.astravia.uiZoom.set(next);
	}, []);

	const reset = useCallback(() => {
		setFactorState(UI_ZOOM_DEFAULT);
		void window.astravia.uiZoom.reset();
	}, []);

	return { factor, setFactor, reset };
}
