import { useEffect } from "react";

/**
 * 可见页向全局顶栏投稿，不可见时撤稿。
 * 对话树走 React `<Activity hidden>` 时 Effects 会拆掉，cleanup 正好把槽还给当前路由。
 */
export function useOwnedHeaderSlot<T>(active: boolean, value: T, write: (next: NoInfer<T> | null) => void): void {
	useEffect(() => {
		if (!active) return;
		write(value);
		return () => write(null);
	}, [active, value, write]);
}
