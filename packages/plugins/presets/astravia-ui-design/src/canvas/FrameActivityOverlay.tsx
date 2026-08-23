import { type CSSProperties, type JSX, useEffect, useState } from "react";
import { BotFace, FluidBackdrop, overlayScale, PALETTES } from "./activity-visuals";
import type { FrameActivity } from "./design-runtime";

/**
 * frame 活动态浮层：浏览（扫描仪+放大镜+思考头像）、修改（疾书头像+打字骨架线）、
 * 创作（流光+星光+蹦跳头像），衬在混沌流体背景（image-gen 生成骨架同款）上。
 * 纯 CSS 动画（keyframes 见 style.css 的 astd-activity 段），不引入 motion——
 * 插件与宿主只共享 react / @astravia/ui。
 *
 * 整层 pointer-events-none：它盖在 iframe / 位图上，吃掉指针会让元素选择失效
 * （同一坑见 FrameView 里的位图注释）。所有元素只动 transform / opacity，
 * 紧贴跨源 iframe 的层动别的属性会逐帧重新光栅化。
 */

type ActiveKind = Exclude<FrameActivity, "updated">;

/**
 * 浮层动画的最长寿命：万一收场信号全丢（end/HMR/turn-end 都没来），满帧动画
 * 不能一直晃眼。到点只撤浮层，标题栏 badge 留着继续报状态。
 *
 * 定得这么宽是因为活动态从「模型开始生成参数」起算（见 design-runtime 的
 * notifyAgentToolArgs）：写一整屏 frame 跑上几十秒是常态，卡得紧的话浮层会在
 * agent 还在干活时自己消失——那正是它要避免的那种「状态不可信」。真正的兜底是
 * turn-end 的全量清扫，这里只防它也丢了的极端情况。
 */
const OVERLAY_MAX_MS = 120_000;

/** 渐入渐出时长，与 style.css 的 .astd-activity-overlay transition 保持一致。 */
const FADE_MS = 300;

export function FrameActivityOverlay({
	activity,
	frameWidth,
}: {
	activity: FrameActivity | undefined;
	/** 钳住浮层里居中件的反向缩放，见 overlayScale。 */
	frameWidth: number;
}): JSX.Element | null {
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
	const scale = overlayScale(frameWidth);
	return (
		<div
			aria-hidden
			className="astd-activity-overlay pointer-events-none absolute inset-0 overflow-hidden"
			// --astd-accent 驱动浮层里所有装饰元素（扫描线/放大镜/打字线/星光/头像）
			// 的着色，只定义在这一层，不外泄到 frame 容器。
			style={{ opacity: visible ? 1 : 0, "--astd-accent": PALETTES[kind].accent } as CSSProperties}
		>
			<FluidBackdrop kind={kind} />
			{kind === "reading" ? (
				<>
					<div className="astd-scan-beam" />
					<div
						className="absolute left-2 top-2"
						style={{ transform: `scale(${scale})`, transformOrigin: "left top" }}
					>
						<BotFace mood="think" />
					</div>
					<div
						className="absolute left-1/2 top-1/2"
						style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
					>
						<div className="astd-magnifier">
							<span className="astd-magnifier-glass" />
							<span className="astd-magnifier-handle" />
						</div>
					</div>
				</>
			) : null}
			{kind === "modifying" ? (
				<div
					className="absolute left-1/2 top-1/2"
					style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
				>
					<div className="astd-activity-chip">
						<BotFace mood="write" />
						<span className="astd-typing-lines">
							<span className="astd-typing-line" />
							<span className="astd-typing-line" />
							<span className="astd-typing-line" />
						</span>
					</div>
				</div>
			) : null}
			{kind === "creating" ? (
				<>
					<span className="astd-spark" style={{ left: "18%", top: "22%" }} />
					<span className="astd-spark" style={{ left: "78%", top: "16%", animationDelay: "0.5s" }} />
					<span className="astd-spark" style={{ left: "68%", top: "72%", animationDelay: "1s" }} />
					<span className="astd-spark" style={{ left: "24%", top: "68%", animationDelay: "1.4s" }} />
					<div
						className="absolute left-1/2 top-1/2"
						style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
					>
						<div className="astd-activity-chip">
							<BotFace mood="bounce" />
						</div>
					</div>
				</>
			) : null}
		</div>
	);
}
