import { useEffect } from "react";
import type { BridgeHub, BridgeHubEvents } from "./bridge-client";

/**
 * 把画布回调接到 bridge 上。
 *
 * 回调换引用时只重新 start（BridgeHub.start 只是换回调），stop 只跟着 bridge 自身
 * 换掉或卸载走。两者不能放进同一个 effect：画布回调依赖的函数会随状态换引用
 * （frameIds 随视口裁剪重排 → refreshAll → storageChanged），每换一次就 stop 一轮的话，
 * stop 会清掉所有 frame 的 iframe 登记，而 FrameView 的注册 effect 不会因此重跑——
 * 之后 iframe 发来的消息认不出是哪一帧（元素选不中），截图报 frame not mounted，
 * 挂起的截图也被当成「bridge stopped」判死。
 */
export function useBridgeEvents(bridge: BridgeHub, events: BridgeHubEvents): void {
	useEffect(() => {
		bridge.start(events);
	}, [bridge, events]);
	useEffect(() => () => bridge.stop(), [bridge]);
}
