import type { JSX } from "react";
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

export function FrameActivityOverlay({ activity }: { activity: FrameActivity }): JSX.Element | null {
	if (activity === "updated") return null;
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
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
