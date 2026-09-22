import type { JSX } from "react";
import { overlayScale } from "./activity-visuals";

/**
 * frame 启动占位：还没有任何位图、活体也没画出来之前盖在容器上的那一层。
 *
 * 静态浅底 + 居中三点。进画布时满屏 frame 一起处在这个状态，任何铺满 frame 的
 * 动画都会乘上 frame 数量，所以动的只有三个点。配色取中性灰，免得被误读成
 * agent 正在干活。
 */
export function FrameLoadingOverlay({ frameWidth }: { frameWidth: number }): JSX.Element {
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-muted">
			<div className="absolute left-1/2 top-1/2" style={{ transform: `translate(-50%, -50%) scale(${overlayScale(frameWidth)})` }}>
				<span className="vetd-loading-dots">
					<span className="vetd-loading-dot" />
					<span className="vetd-loading-dot" />
					<span className="vetd-loading-dot" />
				</span>
			</div>
		</div>
	);
}
