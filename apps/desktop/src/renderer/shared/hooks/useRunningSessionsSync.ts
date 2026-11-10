import { runningSessionPathsAtom } from "@shared/store/running-sessions-atoms";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

/**
 * 同步「后台正在 streaming 的 session 集合」到 runningSessionPathsAtom。
 *
 * 必须在始终挂载的组件（App 根级）调用：该订阅是 streaming 状态的真值来源之一
 * （见 isStreamingAtom）。若挂在会被条件卸载的组件（如 Sidebar，折叠/窄屏/内联
 * 文件预览时会卸载）上，卸载期间 RUNNING_CHANGED 事件会被静默丢弃，导致 atom
 * 变脏、streaming 指示器卡住，直到重新挂载靠 listRunning 快照纠偏。
 */
export function useRunningSessionsSync(): void {
	const setRunningSessionPaths = useSetAtom(runningSessionPathsAtom);
	useEffect(() => {
		let cancelled = false;
		const sync = (): void => {
			void window.astravia.session.listRunning().then((paths) => {
				if (cancelled) return;
				setRunningSessionPaths(new Set(paths));
			});
		};
		sync();
		const unsubscribe = window.astravia.session.onRunningChanged(({ sessionPath, running }) => {
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
		// 断网期间 RUNNING_CHANGED 会丢：内核在轮次结束/取消时发不出事件，渲染进程
		// 就一直以为还在生成，输入框、停止按钮都锁着，用户只能看着一个不动的会话。
		// 网络回来时向主进程重拉一次快照，用真实状态覆盖掉陈旧的那份。
		window.addEventListener("online", sync);
		return () => {
			cancelled = true;
			window.removeEventListener("online", sync);
			unsubscribe();
		};
	}, [setRunningSessionPaths]);
}
