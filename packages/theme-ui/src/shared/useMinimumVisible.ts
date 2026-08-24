import { useEffect, useRef, useState } from "react";

/**
 * 给一段瞬时状态兜一个最短可见时长：`active` 变 false 后，仍保持可见直到本次
 * 展示满 `minVisibleMs`，避免内容一闪而过。停留期间 `active` 重新变 true，
 * 计时从头再起，可见性全程不中断（不会卸载重挂，因而不会闪）。
 *
 * 打开是同步的；只有收起会被推迟。
 */
export function useMinimumVisible(active: boolean, minVisibleMs: number): boolean {
	const [visible, setVisible] = useState(active);
	const shownAtRef = useRef(0);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const clear = () => {
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
			}
		};

		if (active) {
			clear();
			// 每一段都从头计一次最短时长，接力时不会因为上一段的计时到点而收起。
			shownAtRef.current = performance.now();
			setVisible(true);
			return;
		}

		const remaining = minVisibleMs - (performance.now() - shownAtRef.current);
		if (remaining <= 0) {
			setVisible(false);
			return clear;
		}
		clear();
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			setVisible(false);
		}, remaining);
		return clear;
	}, [active, minVisibleMs]);

	return visible;
}
