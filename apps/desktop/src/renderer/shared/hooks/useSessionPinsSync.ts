import {
	clearLegacySidebarSessionPins,
	pinnedSessionPathsAtom,
	takeLegacySidebarSessionPins,
} from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { sessionPinsFromSnapshot, toSessionPinsSnapshot } from "../../../shared/session-pins";

/**
 * 把主进程持有的会话置顶同步到渲染进程：首屏先交出旧版本留在 localStorage 的
 * 置顶，再拉一次快照，之后跟随广播刷新（包括配对手机上的置顶）。挂在始终挂载
 * 的根布局上，侧边栏收起期间也不丢广播。
 */
export function useSessionPinsSync(): void {
	const setPins = useSetAtom(pinnedSessionPathsAtom);

	useEffect(() => {
		let disposed = false;
		const apply = (snapshot: Parameters<typeof sessionPinsFromSnapshot>[0]): void => {
			if (!disposed) setPins(sessionPinsFromSnapshot(snapshot));
		};
		const legacy = takeLegacySidebarSessionPins();
		const load =
			legacy.size > 0
				? window.vetta.sessionPins.importLegacy(toSessionPinsSnapshot(legacy)).then((snapshot) => {
						clearLegacySidebarSessionPins();
						return snapshot;
					})
				: window.vetta.sessionPins.list();
		void load.then(apply).catch(() => {
			// 读不到就维持空置顶：侧边栏照常按时间排序，不阻塞。
		});
		const unsubscribe = window.vetta.sessionPins.onChanged(apply);
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [setPins]);
}
