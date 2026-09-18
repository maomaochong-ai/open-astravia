import { useEffect, useState } from "react";
import { waitForCommittedPaint } from "../lib/committed-paint";

/**
 * React 19 把侧栏 navigate 放进 startTransition：新树里一旦有 React.lazy，
 * 即使包了 Suspense fallback，也会等 chunk 才露出新页。
 *
 * 第一次作为前台页挂载时先提交同步壳；隐藏预挂则立刻允许 lazy，让 chunk
 * 在后台开始加载（Activity hidden 会拆 effects，不能再靠绘制屏障去挂叶子）。
 */
export function useAllowLazyAfterFirstPaint(active: boolean): boolean {
	const [allowLazy, setAllowLazy] = useState(!active);
	useEffect(() => {
		if (allowLazy) return;
		let cancelled = false;
		void waitForCommittedPaint().then(() => {
			if (!cancelled) setAllowLazy(true);
		});
		return () => {
			cancelled = true;
		};
	}, [allowLazy]);
	return allowLazy;
}
