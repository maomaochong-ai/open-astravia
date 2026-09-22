/**
 * frame 浮层共用的零件：各活动态的语义色与居中件的缩放。活动态浮层（读/改/写）
 * 与启动占位（loading）都从这里取，所以单独成模块。
 */

/** 有专属浮层的活动态。 */
export type ActivityVisualKind = "reading" | "modifying" | "creating";

/**
 * 各态一套固定色，不读宿主主题变量——mono 主题下 primary/ring 全是黑白灰，
 * 三种状态就分不出来了。色相同时承担语义，与标题栏徽标的三色（sky / indigo /
 * fuchsia）对齐：扫一眼就知道 agent 在干什么。
 */
export const ACTIVITY_ACCENTS: Record<ActivityVisualKind, string> = {
	// 浏览：青蓝，冷静的「在看」。
	reading: "#0ea5e9",
	// 修改：靛紫。
	modifying: "#6366f1",
	// 创作：品红，最暖最跳，对应从无到有。
	creating: "#d946ef",
};

/** 标题栏同款反向缩放：浮层元素要在任何画布缩放下保持可读大小。 */
export const INVERSE_SCALE = "var(--vetd-lscale, 1)";

/**
 * 居中件在这个宽度上正好占满 frame。反向缩放的上限由它换算出来：
 * 居中件本身约 90px 宽，除以它得到「最多占 frame 宽度的 40%」。
 */
const OVERLAY_FIT_WIDTH = 220;

/**
 * 浮层居中件的缩放：反向缩放（屏幕上恒定大小）与「不超过 frame 的一小块」取小。
 *
 * 只用反向缩放会在画布缩小时炸掉——lscale 到 5、8 的时候，居中件在世界坐标里比整个
 * frame 还宽，一屏几十个 frame 上全是同样大的东西，比稿子本身还抢眼。钳住之后它
 * 跟着 frame 一起缩，缩到看不清时本来也不需要看清。
 */
export function overlayScale(frameWidth: number): string {
	return `min(${INVERSE_SCALE}, ${(Math.max(frameWidth, 1) / OVERLAY_FIT_WIDTH).toFixed(3)})`;
}
