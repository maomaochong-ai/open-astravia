import { type CSSProperties, type JSX } from "react";
import { BotFace, FluidBackdrop, overlayScale, PALETTES } from "./activity-visuals";

/**
 * frame 启动占位：还没有任何位图、活体也没画出来之前盖在容器上的那一层。
 *
 * 用的是活动态浮层同一套形象语言（流体背景 + 胶囊里的 Astravia 头像），而不是一个
 * 通用 spinner——进画布时满屏 frame 一起加载，那是用户见到这个产品的第一眼。
 * 头像用 think：此刻是「在等它起来」，不是 agent 在改稿；配色也取最安静的蓝灰
 * （见 PALETTES.loading），免得被误读成 agent 正在干活。
 */
export function FrameLoadingOverlay({ frameWidth }: { frameWidth: number }): JSX.Element {
	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-0 overflow-hidden bg-muted"
			// 同活动态浮层：--astd-accent 只驱动这一层里的装饰件，不外泄到 frame 容器。
			style={{ "--astd-accent": PALETTES.loading.accent } as CSSProperties}
		>
			<FluidBackdrop kind="loading" />
			<div className="absolute left-1/2 top-1/2" style={{ transform: `translate(-50%, -50%) scale(${overlayScale(frameWidth)})` }}>
				<div className="astd-activity-chip">
					<BotFace mood="think" />
					<span className="astd-loading-dots">
						<span className="astd-loading-dot" />
						<span className="astd-loading-dot" />
						<span className="astd-loading-dot" />
					</span>
				</div>
			</div>
		</div>
	);
}
