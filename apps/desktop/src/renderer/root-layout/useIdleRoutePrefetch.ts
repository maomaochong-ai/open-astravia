import { useEffect } from "react";

/**
 * 空闲期预取高频入口的路由 chunk。
 *
 * 侧栏置顶默认只有「能力」和设计画廊两个入口；设计画廊由插件宿主在启动时加载，
 * 而能力页是 React.lazy 的独立 chunk——低配机上首次点击要现付「下载 + 解析 +
 * 求值」。这里在首帧之后的空闲时间把它拉进模块缓存，点击时零等待。
 * 用 requestIdleCallback（带兜底超时）避免与启动关键路径抢主线程。
 */
const PREFETCHERS: ReadonlyArray<() => Promise<unknown>> = [
	() => import("../domains/abilities/components/AbilitiesPage"),
];

export function useIdleRoutePrefetch(): void {
	useEffect(() => {
		const run = (): void => {
			for (const load of PREFETCHERS) {
				void load().catch(() => {
					// 预取失败无需上报：真正导航时 React.lazy 会重试并走正常错误路径。
				});
			}
		};
		if (typeof window.requestIdleCallback === "function") {
			const id = window.requestIdleCallback(run, { timeout: 8000 });
			return () => window.cancelIdleCallback(id);
		}
		const id = window.setTimeout(run, 3000);
		return () => window.clearTimeout(id);
	}, []);
}
