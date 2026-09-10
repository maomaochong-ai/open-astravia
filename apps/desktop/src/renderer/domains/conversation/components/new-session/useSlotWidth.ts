import { useLayoutEffect, useRef, useState } from "react";

export interface SlotWidth {
	/** 挂到要测量的容器上。 */
	readonly ref: React.RefObject<HTMLDivElement | null>;
	/** 容器当前宽度；null = 尚未测量。 */
	readonly width: number | null;
}

/**
 * 按容器实际宽度做响应式取舍的公共测量钩子。
 *
 * 刻意不看窗口宽度：活动面板展开、侧边栏展开都会压窄新会话页这一列，窗口再宽也放不下内容。
 * 首帧走 layout effect，避免先按错误宽度画一版再改；未测量时返回 null，由调用方决定这一帧渲染什么。
 */
export function useSlotWidth(): SlotWidth {
	const ref = useRef<HTMLDivElement | null>(null);
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

	return { ref, width };
}
