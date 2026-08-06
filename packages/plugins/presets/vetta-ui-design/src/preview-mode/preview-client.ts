/**
 * 预览 dialog 与它那个 iframe 的通信。
 *
 * 刻意不走画布的 {@link BridgeHub}：那边按 frameId 路由消息、还挂着截图队列与
 * 元素选择，预览这一份注册进去只会跟画布上同 id 的那帧撞车（截图请求发错窗口、
 * rendered 信号被当成画布的交接点）。预览要的东西也少得多——导航，仅此而已。
 */
import { type RefObject, useCallback, useEffect, useState } from "react";

export interface PreviewNavState {
	/** 当前地址，如 `/login`。 */
	path: string;
	/** 该地址对应的 frame id；地址不认识时为 null。 */
	frameId: string | null;
	canBack: boolean;
	canForward: boolean;
}

export interface PreviewBridge {
	/** 首条 navigated 到达前为 null（iframe 还在加载）。 */
	nav: PreviewNavState | null;
	navigateTo(path: string): void;
	/** 前进/后退：-1 / 1。 */
	go(delta: number): void;
	/** 整页重载——帧内 state 一起清掉，客户端路由做不到这件事。 */
	reload(): void;
}

export function usePreviewBridge(iframeRef: RefObject<HTMLIFrameElement | null>): PreviewBridge {
	const [nav, setNav] = useState<PreviewNavState | null>(null);

	useEffect(() => {
		const onMessage = (event: MessageEvent): void => {
			// 画布上的每个 frame 也在往同一个 window 发消息，来源过滤是必须的。
			if (event.source !== iframeRef.current?.contentWindow) return;
			const data = event.data as Record<string, unknown> | null;
			if (!data || data.vetd !== true || data.type !== "navigated") return;
			setNav({
				path: typeof data.path === "string" ? data.path : "/",
				frameId: typeof data.frameId === "string" ? data.frameId : null,
				canBack: data.canBack === true,
				canForward: data.canForward === true,
			});
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [iframeRef]);

	const post = useCallback(
		(message: Record<string, unknown>): void => {
			iframeRef.current?.contentWindow?.postMessage({ vetd: true, ...message }, "*");
		},
		[iframeRef],
	);

	const navigateTo = useCallback((path: string): void => post({ type: "navigate", to: path }), [post]);
	const go = useCallback((delta: number): void => post({ type: "navigate", delta }), [post]);
	const reload = useCallback((): void => post({ type: "reload" }), [post]);

	return { nav, navigateTo, go, reload };
}
