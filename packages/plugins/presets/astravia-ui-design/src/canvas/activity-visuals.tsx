/**
 * frame 浮层的视觉零件：Astravia 形象（BotFace）、混沌流体背景（FluidBackdrop）与
 * 各态色板。活动态浮层（读/改/写）与启动占位（loading）共用同一套形象语言，
 * 所以从 FrameActivityOverlay 里提出来独立成模块。
 *
 * 纯 CSS 动画（keyframes 见 style.css 的 astd-activity 段），不引入 motion——
 * 插件与宿主只共享 react / @astravia/ui。
 */
import type { JSX } from "react";

/** 有专属动画的浮层种类：三个活动态 + frame 启动期的占位。 */
export type ActivityVisualKind = "reading" | "modifying" | "creating" | "loading";

/** theme-ui BotAvatar（sm）的纯 CSS 迷你版：渐变方块 + 双眼，动作由 mood class 驱动。 */
export function BotFace({ mood }: { mood: "think" | "write" | "bounce" }): JSX.Element {
	return (
		<span className={`astd-bot astd-bot-${mood}`}>
			<span className="astd-bot-head">
				<span className="astd-bot-eye" />
				<span className="astd-bot-eye" />
			</span>
			{mood === "think" ? <span className="astd-bot-bubble" /> : null}
		</span>
	);
}

/**
 * 五个 blob 的几何：位置/大小/旋转固定，颜色按活动态取（见 PALETTES）。
 * 经旋转层 + 重模糊融成流动渐变（对齐 image-gen 的生成骨架）。
 */
const BLOB_SHAPES: { left: string; top: string; w: string; h: string; rotate: number }[] = [
	{ left: "-15%", top: "-20%", w: "75%", h: "75%", rotate: -8 },
	{ left: "55%", top: "-15%", w: "70%", h: "70%", rotate: 12 },
	{ left: "-10%", top: "55%", w: "70%", h: "75%", rotate: 18 },
	{ left: "45%", top: "50%", w: "75%", h: "70%", rotate: -14 },
	{ left: "25%", top: "20%", w: "55%", h: "60%", rotate: 6 },
];

/**
 * 各态一套固定色板，不读宿主主题变量——mono 主题下 primary/ring/accent 全是
 * 黑白灰，五个 blob 一模糊就互相抵消成中性灰。色相同时承担语义，与标题栏徽标
 * 的三色（sky / indigo / fuchsia）对齐：扫一眼就知道 agent 在干什么。
 */
export const PALETTES: Record<ActivityVisualKind, { accent: string; blobs: [string, string, string, string, string] }> =
	{
		// 浏览：青蓝，冷静的「在看」。
		reading: { accent: "#0ea5e9", blobs: ["#0ea5e9", "#22d3ee", "#38bdf8", "#6366f1", "#2dd4bf"] },
		// 修改：靛紫，与「修改中」呼吸描边同调。
		modifying: { accent: "#6366f1", blobs: ["#6366f1", "#8b5cf6", "#a78bfa", "#4f46e5", "#c4b5fd"] },
		// 创作：品红橙，最暖最跳，对应从无到有。
		creating: { accent: "#d946ef", blobs: ["#d946ef", "#f472b6", "#fb7185", "#f59e0b", "#c084fc"] },
		// 启动：低饱和的蓝灰，刻意最安静——它是每次进画布都会看到的等待态，
		// 用活动态那种饱和色会让「什么都没发生」看起来像 agent 在干活。
		loading: { accent: "#64748b", blobs: ["#94a3b8", "#a5b4fc", "#7dd3fc", "#cbd5e1", "#818cf8"] },
	};

export function FluidBackdrop({ kind }: { kind: ActivityVisualKind }): JSX.Element {
	const { blobs } = PALETTES[kind];
	return (
		<div className="astd-fluid">
			<div className="astd-fluid-spin">
				{BLOB_SHAPES.map((b, i) => (
					<div
						key={i}
						className="absolute"
						style={{ left: b.left, top: b.top, width: b.w, height: b.h, transform: `rotate(${b.rotate}deg)` }}
					>
						{/* 时长/相位各自错开，叠加后无规律流转。 */}
						<div
							className="astd-fluid-blob"
							style={{ background: blobs[i], animationDuration: `${5 + i * 1.3}s`, animationDelay: `${i * -1.7}s` }}
						/>
					</div>
				))}
			</div>
		</div>
	);
}

/** 标题栏同款反向缩放：浮层元素要在任何画布缩放下保持可读大小。 */
export const INVERSE_SCALE = "var(--astd-lscale, 1)";

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
