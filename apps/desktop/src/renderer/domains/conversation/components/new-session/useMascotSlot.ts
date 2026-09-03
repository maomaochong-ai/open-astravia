import { useLayoutEffect, useRef, useState } from "react";
import { MASCOT_MIN_SLOT_WIDTH } from "./constants";

export interface MascotSlot {
	/** 挂到吉祥物插槽容器上；插槽宽度即 hero 宽度。 */
	readonly ref: React.RefObject<HTMLDivElement | null>;
	/** 插槽够宽才渲染吉祥物。 */
	readonly visible: boolean;
}

/**
 * 按插槽实际宽度决定是否渲染吉祥物。
 *
 * 刻意不看窗口宽度：活动面板展开、侧边栏展开都会压窄这块区域，窗口再宽也放不下素材。
 * 首帧测量走 layout effect，避免窄页面先画出吉祥物再抽掉。
 */
export function useMascotSlot(threshold = MASCOT_MIN_SLOT_WIDTH): MascotSlot {
	const ref = useRef<HTMLDivElement | null>(null);
	// null = 尚未测量；此时不渲染，宁可晚一帧出现也不要闪一下再消失。
	const [width, setWidth] = useState<number | null>(null);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		setWidth(element.getBoundingClientRect().width);
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) setWidth(entry.contentRect.width);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return { ref, visible: width !== null && width >= threshold };
}
