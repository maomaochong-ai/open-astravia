import { useEffect } from "react";
import { prefetchIdleRoutes } from "./route-prefetch";

/**
 * 空闲期预取高频入口的路由 chunk（Next.js `router.prefetch` 同款：idle + 最迟时限）。
 * 真正点进侧栏时模块已在缓存里，避免首次打开现解析 lazy chunk。
 */
export function useIdleRoutePrefetch(): void {
	useEffect(() => prefetchIdleRoutes(), []);
}
