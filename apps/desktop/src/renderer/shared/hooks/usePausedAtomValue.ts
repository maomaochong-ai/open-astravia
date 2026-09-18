import { type Atom, useStore } from "jotai";
import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * 订阅 atom，但 `paused` 时冻结快照并卸掉订阅（TanStack Query `enabled: false` 同款）。
 *
 * React `<Activity hidden>` 会拆 Effects、降优先级重渲染，但 jotai 走
 * `useSyncExternalStore`，不是 Effect。隐藏对话时必须停订 `chatMessagesAtom`，
 * 否则后台流式仍会在空闲切片里重跑整棵消息树。
 */
export function usePausedAtomValue<T>(anAtom: Atom<T>, paused: boolean): T {
	const store = useStore();
	const frozenRef = useRef(store.get(anAtom));
	if (!paused) frozenRef.current = store.get(anAtom);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			if (paused) return () => undefined;
			return store.sub(anAtom, onStoreChange);
		},
		[anAtom, paused, store],
	);

	const getSnapshot = useCallback(() => (paused ? frozenRef.current : store.get(anAtom)), [anAtom, paused, store]);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
