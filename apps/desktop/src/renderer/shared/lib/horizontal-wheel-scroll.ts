/**
 * 让一条横向排列的工具行在桌面上也能「左右切换」。
 *
 * 现状：输入框左侧的工具行（技能 / 附件 / 执行模式 / 活动胶囊）是 `flex` 挤在一行里。
 * 工具一多，超出宽度的部分被直接裁掉，而鼠标没有横向滚轮，触控板用户能两指横扫、
 * 台式机用户就只能看着按钮消失。macOS 的滚动条默认还隐藏，连「这里可以滚」都看不出来。
 *
 * 处理：纵向滚轮在**真的溢出**时映射为横向滚动，并在两端自然停住（不冒泡到页面）。
 * 不溢出时什么都不做——否则会把页面的纵向滚动抢走。
 */
export interface HorizontalWheelTarget {
	scrollLeft: number;
	readonly scrollWidth: number;
	readonly clientWidth: number;
	/** `WheelEvent.deltaMode` 为 1（按行）时，一个 delta 大约对应多少像素。 */
	readonly lineHeightPx?: number;
}

export interface HorizontalWheelResult {
	/** 是否消费了这次滚动（调用方据此决定 preventDefault）。 */
	readonly handled: boolean;
	/** 处理后应写回的 scrollLeft；handled 为 false 时等于原值。 */
	readonly scrollLeft: number;
}

const DEFAULT_LINE_HEIGHT = 20;

/**
 * 纯计算版：给定容器状态与滚轮增量，算出新的 scrollLeft 以及是否应该拦截默认行为。
 * 抽成纯函数是因为 jsdom 里真实的滚动布局算不出来（scrollWidth 恒为 0）。
 */
export function resolveHorizontalWheel(
	target: HorizontalWheelTarget,
	deltaX: number,
	deltaY: number,
	deltaMode: number,
): HorizontalWheelResult {
	const overflow = target.scrollWidth - target.clientWidth;
	if (overflow <= 1) return { handled: false, scrollLeft: target.scrollLeft };

	// 横向滚动优先用 deltaX；没有横向分量时把纵向分量搬过来。
	const raw = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
	const scale = deltaMode === 1 ? (target.lineHeightPx ?? DEFAULT_LINE_HEIGHT) : 1;
	const next = Math.min(overflow, Math.max(0, target.scrollLeft + raw * scale));
	if (next === target.scrollLeft) {
		// 已经到头：仍然拦下这次滚动，避免页面跟着抖一下。
		return { handled: true, scrollLeft: next };
	}
	return { handled: true, scrollLeft: next };
}

/** 事件适配：把 DOM 的 wheel 事件套到纯函数上。 */
export function handleHorizontalWheel(event: {
	deltaX: number;
	deltaY: number;
	deltaMode: number;
	currentTarget: EventTarget | null;
	preventDefault: () => void;
}): void {
	const target = event.currentTarget as HTMLElement | null;
	if (!target) return;
	const result = resolveHorizontalWheel(
		{ scrollLeft: target.scrollLeft, scrollWidth: target.scrollWidth, clientWidth: target.clientWidth },
		event.deltaX,
		event.deltaY,
		event.deltaMode,
	);
	if (!result.handled) return;
	event.preventDefault();
	target.scrollLeft = result.scrollLeft;
}

/** 工具行的滚动容器类名：隐藏滚动条，但仍可滚动与键盘聚焦。 */
export const TOOLBAR_SCROLL_CLASS =
	"overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
