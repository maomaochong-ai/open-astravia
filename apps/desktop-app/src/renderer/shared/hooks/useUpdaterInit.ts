import { updaterStateAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

/**
 * 挂在 RootLayout：拉一次主进程当前 UpdaterState，并订阅状态变化。
 * 更新就绪只通过侧边栏底部的提示项告知，不自动弹全局对话框。
 */
export function useUpdaterInit(): void {
	const setState = useSetAtom(updaterStateAtom);

	useEffect(() => {
		let cancelled = false;
		void window.vetta.updater.getState().then((s) => {
			if (cancelled) return;
			setState(s);
		});

		const unsubscribe = window.vetta.updater.onStateChanged(setState);

		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [setState]);
}
