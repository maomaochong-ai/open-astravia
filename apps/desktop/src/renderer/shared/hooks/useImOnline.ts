import { useEffect, useState } from "react";

/**
 * IM 传输是否在线（online / connecting 视为在线）。
 * 订阅主进程 im 状态，seed 一次初始值；断连返回 false。多处（侧边栏顶栏、底部 Claw 徽章）复用。
 */
export function useImOnline(): boolean {
	const [online, setOnline] = useState(false);

	useEffect(() => {
		let cancelled = false;
		let unsub: (() => void) | null = null;
		void (async () => {
			try {
				const unsubFn = await window.vetta.im.subscribeStatus(
					(s) => setOnline(s.transport === "online" || s.transport === "connecting"),
					() => {},
				);
				if (cancelled) {
					unsubFn();
					return;
				}
				unsub = unsubFn;
				// subscribeStatus 的首帧与监听器挂载存在竞态，显式拉一次 seed 初始态。
				const current = await window.vetta.im.getStatus();
				if (!cancelled) setOnline(current.transport === "online" || current.transport === "connecting");
			} catch {
				// ignore; 徽章保持隐藏
			}
		})();
		return () => {
			cancelled = true;
			unsub?.();
		};
	}, []);

	return online;
}
