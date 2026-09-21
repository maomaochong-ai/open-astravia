import {
	BOTTOM_PANEL_MAX_HEIGHT_RATIO,
	BOTTOM_PANEL_MIN_HEIGHT_RATIO,
	bottomPanelStateAtom,
	clampBottomPanelHeightRatio,
	dispatchBottomPanelAtom,
	dispatchTransientBottomPanelAtom,
	persistBottomPanelAtom,
} from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useRef } from "react";

/** 面板再矮就画不出一行终端了，比例算出来低于它直接按它算。 */
export const BOTTOM_PANEL_MIN_HEIGHT_PX = 120;

export interface BottomPanelSizing {
	readonly heightRatio: number;
	/** 折算成像素的面板高度；容器高度未知（首帧）时返回 null。 */
	resolveHeightPx(containerHeightPx: number): number;
	onHeightResizeStart(): void;
	/** delta 为正表示面板变高（ResizeHandle 的 side="top" 已经处理过方向）。 */
	onHeightResize(deltaPx: number, containerHeightPx: number): void;
	onHeightResizeEnd(): void;
	onSplitResizeStart(): void;
	onSplitResize(groupId: string, index: number, deltaPx: number, extentPx: number): void;
	onSplitResizeEnd(): void;
}

/**
 * 面板高度与分屏比例。
 *
 * 存的是**比例**而不是像素：存像素会让面板在窗口变大后只缩不涨（与活动面板宽度
 * 的 `ActivityPanelWidthMode` 同一个理由）。拖拽期间只改内存，松手才落盘。
 */
export function useBottomPanelSizing(): BottomPanelSizing {
	const state = useAtomValue(bottomPanelStateAtom);
	const dispatch = useSetAtom(dispatchBottomPanelAtom);
	const dispatchTransient = useSetAtom(dispatchTransientBottomPanelAtom);
	const persist = useSetAtom(persistBottomPanelAtom);
	/** 拖拽期间的实时比例：state 的更新是异步的，逐帧读它会把增量算丢。 */
	const liveRatioRef = useRef(state.heightRatio);

	const resolveHeightPx = useCallback(
		(containerHeightPx: number) =>
			Math.max(BOTTOM_PANEL_MIN_HEIGHT_PX, Math.round(containerHeightPx * state.heightRatio)),
		[state.heightRatio],
	);

	return {
		heightRatio: state.heightRatio,
		resolveHeightPx,
		onHeightResizeStart: useCallback(() => {
			liveRatioRef.current = state.heightRatio;
		}, [state.heightRatio]),
		onHeightResize: useCallback(
			(deltaPx: number, containerHeightPx: number) => {
				if (containerHeightPx <= 0) return;
				const next = clampBottomPanelHeightRatio(liveRatioRef.current + deltaPx / containerHeightPx);
				liveRatioRef.current = next;
				dispatchTransient({ type: "set-height-ratio", ratio: next });
			},
			[dispatchTransient],
		),
		onHeightResizeEnd: useCallback(() => {
			dispatch({ type: "set-height-ratio", ratio: liveRatioRef.current });
		}, [dispatch]),
		onSplitResizeStart: useCallback(() => {}, []),
		onSplitResize: useCallback(
			(groupId: string, index: number, deltaPx: number, extentPx: number) => {
				if (extentPx <= 0) return;
				dispatchTransient({ type: "resize-group", groupId, index, delta: deltaPx / extentPx });
			},
			[dispatchTransient],
		),
		onSplitResizeEnd: useCallback(() => persist(), [persist]),
	};
}

export { BOTTOM_PANEL_MAX_HEIGHT_RATIO, BOTTOM_PANEL_MIN_HEIGHT_RATIO };
