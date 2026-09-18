import { createContext, useContext, useRef } from "react";

/**
 * 当前 Persistent/Deferred surface 是否在前台。
 * 由 `DeferredSurface` 提供；未包裹时默认为 true，页面单测不必再套一层。
 */
export const SurfaceActiveContext = createContext(true);

export function useSurfaceActive(): boolean {
	return useContext(SurfaceActiveContext);
}

/**
 * 隐藏保活树仍会读到当前 URL。身份类值在切走后冻结，避免设置标签 / 新会话 cwd 被别的路由改掉。
 */
export function useInactiveFrozenValue<T>(active: boolean, value: T): T {
	const ref = useRef(value);
	if (active) ref.current = value;
	return active ? value : ref.current;
}
