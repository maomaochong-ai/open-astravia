import { runningSessionPathsAtom } from "@shared/store/running-sessions-atoms";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

/**
 * 同步「后台正在 streaming 的 session 集合」到 runningSessionPathsAtom。
 *
 * 必须在始终挂载的组件（App 根级）调用：该订阅是 streaming 状态的真值来源之一
 * （见 isStreamingAtom）。若挂在会被条件卸载的组件（如 Sidebar，折叠/窄屏/内联
 * 文件预览时会卸载）上，卸载期间 RUNNING_CHANGED 事件会被静默丢弃，导致 atom
 * 变脏、streaming 指示器卡住，直到组件重新挂载靠 listRunning 快照纠偏。
 */
export function useRunningSessionsSync(): void {
	const setRunningSessionPaths = useSetAtom(runningSessionPathsAtom);
	useEffect(() => {
		let cancelled = false;
		void window.vetta.session.listRunning().then((paths) => {
			if (cancelled) return;
			setRunningSessionPaths(new Set(paths));
		});
		const unsubscribe = window.vetta.session.onRunningChanged(({ sessionPath, running }) => {
			setRunningSessionPaths((prev: Set<string>) => {
				const had = prev.has(sessionPath);
				if (running && had) return prev;
				if (!running && !had) return prev;
				const next = new Set(prev);
				if (running) next.add(sessionPath);
				else next.delete(sessionPath);
				return next;
			});
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [setRunningSessionPaths]);
}
