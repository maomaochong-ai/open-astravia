import { type JSX, useEffect, useState } from "react";
import type { FrameActivity } from "./design-runtime";

/**
 * frame 活动态浮层：浏览（扫描仪+放大镜+思考头像）、修改（疾书头像+打字骨架线）、
 * 创作（流光+星光+蹦跳头像），衬在混沌流体背景（image-gen 生成骨架同款）上。
 * 纯 CSS 动画（keyframes 见 style.css 的 vetd-activity 段），不引入 motion——
 * 插件与宿主只共享 react / @vetta/ui。
 *
 * 整层 pointer-events-none：它盖在 iframe / 位图上，吃掉指针会让元素选择失效
 * （同一坑见 FrameView 里的位图注释）。所有元素只动 transform / opacity，
 * 紧贴跨源 iframe 的层动别的属性会逐帧重新光栅化。
 */

type ActiveKind = Exclude<FrameActivity, "updated">;

/** theme-ui BotAvatar（sm）的纯 CSS 迷你版：渐变方块 + 双眼，动作由 mood class 驱动。 */
function BotFace({ mood }: { mood: "think" | "write" | "bounce" }): JSX.Element {
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
 * 混沌流体背景：实色 blob 经旋转层 + 重模糊融成流动渐变（对齐 image-gen 的
 * 生成骨架）。时长/相位各自错开，叠加后无规律流转。
 */
const FLUID_BLOBS: { left: string; top: string; w: string; h: string; rotate: number; color: string }[] = [
	{ left: "-15%", top: "-20%", w: "75%", h: "75%", rotate: -8, color: "var(--primary, #6366f1)" },
	{ left: "55%", top: "-15%", w: "70%", h: "70%", rotate: 12, color: "var(--accent, #a5b4fc)" },
	{ left: "-10%", top: "55%", w: "70%", h: "75%", rotate: 18, color: "var(--ring, #818cf8)" },
	{ left: "45%", top: "50%", w: "75%", h: "70%", rotate: -14, color: "var(--chart-2, #60a5fa)" },
	{ left: "25%", top: "20%", w: "55%", h: "60%", rotate: 6, color: "var(--chart-4, #c084fc)" },
];

function FluidBackdrop(): JSX.Element {
	return (
		<div className="vetd-fluid">
			<div className="vetd-fluid-spin">
				{FLUID_BLOBS.map((b, i) => (
					<div
						key={i}
						className="absolute"
						style={{ left: b.left, top: b.top, width: b.w, height: b.h, transform: `rotate(${b.rotate}deg)` }}
					>
						<div
							className="vetd-fluid-blob"
							style={{ background: b.color, animationDuration: `${5 + i * 1.3}s`, animationDelay: `${i * -1.7}s` }}
						/>
					</div>
				))}
			</div>
		</div>
	);
}

/** 标题栏同款反向缩放：浮层元素要在任何画布缩放下保持可读大小。 */
const INVERSE_SCALE = "var(--vetd-lscale, 1)";

/**
 * 浮层动画的最长寿命：万一收场信号全丢（end/HMR/turn-end 都没来），满帧动画
 * 不能一直晃眼。到点只撤浮层，标题栏 badge 留着继续报状态。
 */
const OVERLAY_MAX_MS = 5_000;

/** 渐入渐出时长，与 style.css 的 .vetd-activity-overlay transition 保持一致。 */
const FADE_MS = 300;

export function FrameActivityOverlay({ activity }: { activity: FrameActivity | undefined }): JSX.Element | null {
	const [expired, setExpired] = useState(false);
	useEffect(() => {
		setExpired(false);
		if (activity === undefined || activity === "updated") return;
		const timer = window.setTimeout(() => setExpired(true), OVERLAY_MAX_MS);
		return () => window.clearTimeout(timer);
	}, [activity]);

	const show = activity !== undefined && activity !== "updated" && !expired;

	/**
	 * 渐出期间 activity 已经清空，还得知道刚才在放哪种动画，所以把「正在显示的
	 * 状态」留在本地：show 落下后先把 opacity 收到 0，等过渡走完再真正卸载。
	 */
	const [kind, setKind] = useState<ActiveKind | null>(null);
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (show) {
			setKind(activity as ActiveKind);
			// 先以 opacity 0 挂载、下一帧再置 1，否则首帧就是终态，渐入不会发生。
			const raf = requestAnimationFrame(() => setVisible(true));
			return () => cancelAnimationFrame(raf);
		}
		setVisible(false);
		const timer = window.setTimeout(() => setKind(null), FADE_MS);
		return () => window.clearTimeout(timer);
	}, [show, activity]);

	if (kind === null) return null;
	return (
		<div
			aria-hidden
			className="vetd-activity-overlay pointer-events-none absolute inset-0 overflow-hidden"
			style={{ opacity: visible ? 1 : 0 }}
		>
			<FluidBackdrop />
			{kind === "reading" ? (
				<>
					<div className="vetd-scan-beam" />
					<div
						className="absolute left-2 top-2"
						style={{ transform: `scale(${INVERSE_SCALE})`, transformOrigin: "left top" }}
					>
						<BotFace mood="think" />
					</div>
					<div
						className="absolute left-1/2 top-1/2"
						style={{ transform: `translate(-50%, -50%) scale(${INVERSE_SCALE})` }}
					>
						<div className="vetd-magnifier">
							<span className="vetd-magnifier-glass" />
							<span className="vetd-magnifier-handle" />
						</div>
					</div>
				</>
			) : null}
			{kind === "modifying" ? (
				<div
					className="absolute left-1/2 top-1/2"
					style={{ transform: `translate(-50%, -50%) scale(${INVERSE_SCALE})` }}
				>
					<div className="vetd-activity-chip">
						<BotFace mood="write" />
						<span className="vetd-typing-lines">
							<span className="vetd-typing-line" />
							<span className="vetd-typing-line" />
							<span className="vetd-typing-line" />
						</span>
					</div>
				</div>
			) : null}
			{kind === "creating" ? (
				<>
					<span className="vetd-spark" style={{ left: "18%", top: "22%" }} />
					<span className="vetd-spark" style={{ left: "78%", top: "16%", animationDelay: "0.5s" }} />
					<span className="vetd-spark" style={{ left: "68%", top: "72%", animationDelay: "1s" }} />
					<span className="vetd-spark" style={{ left: "24%", top: "68%", animationDelay: "1.4s" }} />
					<div
						className="absolute left-1/2 top-1/2"
						style={{ transform: `translate(-50%, -50%) scale(${INVERSE_SCALE})` }}
					>
						<div className="vetd-activity-chip">
							<BotFace mood="bounce" />
						</div>
					</div>
				</>
			) : null}
		</div>
	);
}
