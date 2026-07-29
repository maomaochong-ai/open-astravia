import { updaterRestartDialogOpenAtom, updaterStateAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useEffect, useRef } from "react";

/**
 * 挂在 RootLayout：拉一次主进程当前 UpdaterState，并订阅状态变化。
 * 当 phase 首次进入 "ready" 时自动弹出"立即重启"对话框。
 */
export function useUpdaterInit(): void {
	const setState = useSetAtom(updaterStateAtom);
	const setDialogOpen = useSetAtom(updaterRestartDialogOpenAtom);
	const prevPhaseRef = useRef<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void window.vetta.updater.getState().then((s) => {
			if (cancelled) return;
			setState(s);
			if (s.phase === "ready") {
				setDialogOpen(true);
			}
			prevPhaseRef.current = s.phase;
		});

		const unsubscribe = window.vetta.updater.onStateChanged((next) => {
			setState(next);
			if (next.phase === "ready" && prevPhaseRef.current !== "ready") {
				setDialogOpen(true);
			}
			prevPhaseRef.current = next.phase;
		});

		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [setState, setDialogOpen]);
}
