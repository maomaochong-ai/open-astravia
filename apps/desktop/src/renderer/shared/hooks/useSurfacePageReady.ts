import { useEffect, useState } from "react";
import { useAllowLazyAfterFirstPaint } from "./useAllowLazyAfterFirstPaint";

/**
 * 保活页把 React.lazy 放进 startTransition 新树时，即使有 Suspense fallback，
 * React 19 也会等 chunk 才露出新页。
 *
 * 所以先提交同步壳，绘制完成后再去拉模块；模块 promise 落地之前不要挂 lazy 叶子。
 * 隐藏预挂跳过绘制等待，但同样等模块回来才挂叶子——点进去时树里没有未完成的 lazy。
 */
export function useSurfacePageReady(active: boolean, load: () => Promise<unknown>): boolean {
	const allowLazy = useAllowLazyAfterFirstPaint(active);
	const [ready, setReady] = useState(false);
	useEffect(() => {
		if (!allowLazy || ready) return;
		let cancelled = false;
		void load().then(
			() => {
				if (!cancelled) setReady(true);
			},
			() => {
				// 失败也放行：让 React.lazy / error boundary 接手，不要永远停在标题壳。
				if (!cancelled) setReady(true);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [allowLazy, load, ready]);
	return ready;
}
