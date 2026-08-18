/**
 * 输入卡片下沿插槽的出入场状态机（纯逻辑，便于单测）。
 *
 * 出入场本身是 CSS 过渡（`grid-template-rows: 0fr ↔ 1fr`），这里只负责两件
 * React 必须参与的事：
 * 1. 入场要先以收起态挂载、下一帧再切展开态，否则没有可过渡的起始值，元素会直接
 *    以最终高度出现；
 * 2. 退场期间内容必须继续留在树里，等过渡跑完再卸载，否则元素瞬间消失、只剩一个
 *    空盒子在收缩。
 */

/** 退场过渡时长，需 ≥ 收起态的 CSS duration。 */
export const INPUT_BAR_FOOTER_EXIT_MS = 220;

export interface InputBarFooterSlotState {
	/** 内容是否留在树里（退场动画期间仍为 true）。 */
	readonly mounted: boolean;
	/** 是否处于展开态，驱动 CSS 过渡的目标值。 */
	readonly expanded: boolean;
}

export type InputBarFooterSlotEvent =
	| { readonly type: "open" }
	| { readonly type: "close" }
	/** 入场挂载后的下一帧。 */
	| { readonly type: "enter-frame" }
	/** 退场过渡结束。 */
	| { readonly type: "exit-end" };

/** 首帧就有内容时直接落到展开态，不播入场动画。 */
export function initialInputBarFooterSlotState(open: boolean): InputBarFooterSlotState {
	return { mounted: open, expanded: open };
}

export function reduceInputBarFooterSlot(
	state: InputBarFooterSlotState,
	event: InputBarFooterSlotEvent,
): InputBarFooterSlotState {
	switch (event.type) {
		case "open":
			// 退场途中被打断时保持挂载并直接回到展开态，让 CSS 从当前高度接着涨；
			// 只有从未挂载的情况才需要先收起一帧来建立过渡起点。
			return state.mounted ? { mounted: true, expanded: true } : { mounted: true, expanded: false };
		case "enter-frame":
			return state.mounted && !state.expanded ? { mounted: true, expanded: true } : state;
		case "close":
			return state.mounted ? { mounted: true, expanded: false } : state;
		case "exit-end":
			// 已经被重新打开时不能卸载，否则会把刚入场的内容摘掉。
			return state.expanded ? state : { mounted: false, expanded: false };
	}
}
