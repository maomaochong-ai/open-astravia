import { useEffect, useState } from "react";

/**
 * 让当前这一帧先交给浏览器呈现，再跑回调。
 * 双 rAF 对齐宿主 `waitForCommittedPaint`：一帧提交布局，下一帧才是可见绘制。
 */
export function runAfterFirstPaint(onPainted: () => void): () => void {
	if (typeof requestAnimationFrame !== "function") {
		const timeoutId = globalThis.setTimeout(onPainted, 0);
		return () => globalThis.clearTimeout(timeoutId);
	}
	let innerId = 0;
	const outerId = requestAnimationFrame(() => {
		innerId = requestAnimationFrame(onPainted);
	});
	return () => {
		cancelAnimationFrame(outerId);
		if (innerId !== 0) cancelAnimationFrame(innerId);
	};
}

/** 首帧为 false；绘制完成后再翻 true。切页 transition 里不要挂会 suspend 的子树。 */
export function useAfterFirstPaint(): boolean {
	const [ready, setReady] = useState(false);
	useEffect(() => runAfterFirstPaint(() => setReady(true)), []);
	return ready;
}
