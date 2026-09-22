import { type CSSProperties, type JSX, useEffect, useState } from "react";
import { ACTIVITY_ACCENTS } from "./activity-visuals";
import type { FrameActivity } from "./design-runtime";

/**
 * frame 活动态浮层：浏览 / 修改 / 创作时沿 frame 内缘亮一圈状态色描边，呼吸闪烁。
 * 「在干什么」由标题栏徽标用文字说，这一层只负责让人一眼找到是哪一屏在动。
 * 纯 CSS 动画（keyframes 见 style.css 的 vetd-activity 段），描边静态、只动 opacity。
 *
 * 整层 pointer-events-none：它盖在 iframe / 位图上，吃掉指针会让元素选择失效
 * （同一坑见 FrameView 里的位图注释）。
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
			className="vetd-activity-overlay pointer-events-none absolute inset-0"
			style={{ opacity: visible ? 1 : 0, "--vetd-accent": ACTIVITY_ACCENTS[kind] } as CSSProperties}
		>
			<div className="vetd-activity-ring" />
		</div>
	);
}
