import { type JSX, useEffect, useState } from "react";
import type { FrameActivity } from "./design-runtime";

/**
 * frame 活动态浮层：浏览（扫描仪+放大镜+思考头像）、修改（疾书头像+打字骨架线）、
 * 创作（流光+星光+蹦跳头像）。纯 CSS 动画（keyframes 见 style.css 的
 * vetd-activity 段），不引入 motion——插件与宿主只共享 react / @vetta/ui。
 *
 * 整层 pointer-events-none：它盖在 iframe / 位图上，吃掉指针会让元素选择失效
 * （同一坑见 FrameView 里的位图注释）。所有元素只动 transform / opacity，
 * 紧贴跨源 iframe 的层动别的属性会逐帧重新光栅化。
 */

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

/** 标题栏同款反向缩放：浮层元素要在任何画布缩放下保持可读大小。 */
const INVERSE_SCALE = "var(--vetd-lscale, 1)";

/**
 * 浮层动画的最长寿命：edit/write 态要等 HMR / turn-end 才落定，长轮次里会挂很久，
 * 满帧动画一直晃眼影响看稿。到点只撤浮层，标题栏 badge 留着继续报状态。
 */
const OVERLAY_MAX_MS = 5_000;

export function FrameActivityOverlay({ activity }: { activity: FrameActivity }): JSX.Element | null {
	const [expired, setExpired] = useState(false);
	useEffect(() => {
		setExpired(false);
		if (activity === "updated") return;
		const timer = window.setTimeout(() => setExpired(true), OVERLAY_MAX_MS);
		return () => window.clearTimeout(timer);
	}, [activity]);
	if (activity === "updated" || expired) return null;
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
			{/* 全幅蒙层：告诉用户这一帧正被 agent 占用。frame 内容恒为白底 app，
			    用固定白色而不是主题变量——画布宿主可能是深色主题（下同，胶囊同理）。 */}
			<div className="vetd-activity-veil" />
			{activity === "reading" ? (
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
			{activity === "modifying" ? (
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
			{activity === "creating" ? (
				<>
					<div className="vetd-shimmer" />
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
