/**
 * frame 浮层的视觉零件：Vetta 形象（BotFace）、混沌流体背景（FluidBackdrop）与
 * 各态色板。活动态浮层（读/改/写）用它们，所以从 FrameActivityOverlay 里提出来独立成模块。
 *
 * 流体画在小 canvas 上（见 fluid-canvas.ts），其余是纯 CSS 动画（keyframes 见 style.css
 * 的 vetd-activity 段），不引入 motion——插件与宿主只共享 react / @vetta-org/ui。
 */
import { type JSX, useEffect, useRef } from "react";
import { fluidCanvasSize, startFluid } from "./fluid-canvas";

/** 有专属浮层的活动态。 */
export type ActivityVisualKind = "reading" | "modifying" | "creating";

/** theme-ui BotAvatar（sm）的纯 CSS 迷你版：渐变方块 + 双眼，动作由 mood class 驱动。 */
export function BotFace({ mood }: { mood: "think" | "write" | "bounce" }): JSX.Element {
	return (
		<span className={`vetd-bot vetd-bot-${mood}`}>
			<span className="vetd-bot-head">
				<span className="vetd-bot-eye" />
				<span className="vetd-bot-eye" />
			</span>
			{mood === "think" ? <span className="vetd-bot-bubble" /> : null}
		</span>
	);
}

/**
 * 各态一套固定色板，不读宿主主题变量——mono 主题下 primary/ring/accent 全是
 * 黑白灰，五个 blob 叠在一起就成了中性灰。色相同时承担语义，与标题栏徽标
 * 的三色（sky / indigo / fuchsia）对齐：扫一眼就知道 agent 在干什么。
 */
export const PALETTES: Record<ActivityVisualKind, { accent: string; blobs: [string, string, string, string, string] }> =
	{
		// 浏览：青蓝，冷静的「在看」。
		reading: { accent: "#0ea5e9", blobs: ["#0ea5e9", "#22d3ee", "#38bdf8", "#6366f1", "#2dd4bf"] },
		// 修改：靛紫。
		modifying: { accent: "#6366f1", blobs: ["#6366f1", "#8b5cf6", "#a78bfa", "#4f46e5", "#c4b5fd"] },
		// 创作：品红橙，最暖最跳，对应从无到有。
		creating: { accent: "#d946ef", blobs: ["#d946ef", "#f472b6", "#fb7185", "#f59e0b", "#c084fc"] },
	};

/** 混沌流体背景：一张按 frame 宽高比缩小的 canvas，由 CSS 拉伸铺满 frame。 */
export function FluidBackdrop({
	kind,
	frameWidth,
	frameHeight,
}: {
	kind: ActivityVisualKind;
	frameWidth: number;
	frameHeight: number;
}): JSX.Element {
	const ref = useRef<HTMLCanvasElement | null>(null);
	const { width, height } = fluidCanvasSize(frameWidth, frameHeight);
	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		return startFluid(canvas, PALETTES[kind].blobs);
	}, [kind, width, height]);
	return <canvas ref={ref} className="vetd-fluid" width={width} height={height} />;
}

/** 标题栏同款反向缩放：浮层元素要在任何画布缩放下保持可读大小。 */
export const INVERSE_SCALE = "var(--vetd-lscale, 1)";

/**
 * 居中件（胶囊 / 放大镜）在这个宽度上正好占满 frame。反向缩放的上限由它换算出来：
 * 胶囊本身约 90px 宽，除以它得到「最多占 frame 宽度的 40%」。
 */
const OVERLAY_FIT_WIDTH = 220;

/**
 * 浮层居中件的缩放：反向缩放（屏幕上恒定大小）与「不超过 frame 的一小块」取小。
 *
 * 只用反向缩放会在画布缩小时炸掉——lscale 到 5、8 的时候，胶囊在世界坐标里比整个
 * frame 还宽，一屏几十个 frame 上全是同样大的小人，比稿子本身还抢眼。钳住之后它
 * 跟着 frame 一起缩，缩到看不清时本来也不需要看清（流体背景仍在报状态）。
 */
export function overlayScale(frameWidth: number): string {
	return `min(${INVERSE_SCALE}, ${(Math.max(frameWidth, 1) / OVERLAY_FIT_WIDTH).toFixed(3)})`;
}
