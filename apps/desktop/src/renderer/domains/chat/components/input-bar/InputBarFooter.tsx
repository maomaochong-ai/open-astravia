import { type ReactNode, useEffect, useReducer, useRef } from "react";
import {
	INPUT_BAR_FOOTER_EXIT_MS,
	initialInputBarFooterSlotState,
	reduceInputBarFooterSlot,
} from "./input-bar-footer-state";

/**
 * 输入卡片下沿的附属区。当前只有待办条，之后还会有别的东西挂在这里，所以这里是
 * 一个插槽容器而不是待办专用的包装。
 *
 * 出入场用 CSS 过渡（`grid-template-rows: 0fr ↔ 1fr` + 内容的 opacity/位移），
 * 不用 motion 的 `height: 0 → auto`：后者每帧回主线程写一次内联高度并触发强制样式
 * 重算，而输入栏上方就是虚拟列表，抬高的同时列表要重测量，两者叠在一帧里会掉帧。
 * CSS 过渡跑在浏览器自己的动画时间线上，不占主线程，也不经过 React 协调。
 *
 * 每个槽位各自折叠，所以下沿同时挂多个元素时，某一个的增减不会让其它元素跟着跳。
 */

const SLOT_BASE = "grid transition-[grid-template-rows] motion-reduce:transition-none";
/** 抬高比落下慢一点：涨上来要看清，收回去不该拖沓。 */
const SLOT_EXPANDED = "grid-rows-[1fr] duration-[300ms] ease-[cubic-bezier(0.22,0.61,0.36,1)]";
const SLOT_COLLAPSED = "grid-rows-[0fr] duration-[200ms] ease-[cubic-bezier(0.4,0,1,1)]";

const CONTENT_BASE = "transition-[opacity,transform] motion-reduce:transition-none";
// 内容从下方 4px 托上来，配 expo-out 的收尾，让「腾出空间」和「内容落位」是一个动作。
// 位移只往正方向走，避免越过裁剪盒上沿被切掉。
const CONTENT_EXPANDED = "translate-y-0 opacity-100 duration-[280ms] delay-[40ms] ease-[cubic-bezier(0.16,1,0.3,1)]";
const CONTENT_COLLAPSED = "translate-y-1 opacity-0 duration-[140ms] ease-[cubic-bezier(0.4,0,1,1)]";

export interface InputBarFooterItem {
	/** 槽位标识，决定顺序与复用；不要随内容变化。 */
	readonly id: string;
	/** 当前内容；`null` 表示该槽位收起（仍会播完退场动画再卸载）。 */
	readonly node: ReactNode;
}

interface InputBarFooterSlotProps {
	readonly open: boolean;
	readonly children: ReactNode;
}

function InputBarFooterSlot({ open, children }: InputBarFooterSlotProps): JSX.Element | null {
	const [state, dispatch] = useReducer(reduceInputBarFooterSlot, open, initialInputBarFooterSlotState);
	/** 退场期间调用方已经把内容置空了，这里得留着上一份内容把动画播完。 */
	const retainedRef = useRef<ReactNode>(null);

	useEffect(() => {
		if (open) retainedRef.current = children;
	});

	useEffect(() => {
		if (open) {
			dispatch({ type: "open" });
			// 先以 0fr 挂载，下一帧再切 1fr，否则没有可过渡的起始值。
			const frame = requestAnimationFrame(() => dispatch({ type: "enter-frame" }));
			return () => cancelAnimationFrame(frame);
		}
		dispatch({ type: "close" });
		const timer = window.setTimeout(() => dispatch({ type: "exit-end" }), INPUT_BAR_FOOTER_EXIT_MS);
		return () => window.clearTimeout(timer);
	}, [open]);

	if (!state.mounted) return null;

	return (
		<div
			className={`${SLOT_BASE} ${state.expanded ? SLOT_EXPANDED : SLOT_COLLAPSED}`}
			aria-hidden={open ? undefined : true}
		>
			<div className="min-w-0 overflow-hidden">
				<div className={`${CONTENT_BASE} ${state.expanded ? CONTENT_EXPANDED : CONTENT_COLLAPSED}`}>
					{open ? children : retainedRef.current}
				</div>
			</div>
		</div>
	);
}

export function InputBarFooter({
	items,
	className,
}: {
	readonly items: readonly InputBarFooterItem[];
	readonly className?: string;
}): JSX.Element {
	return (
		<div className={className}>
			{items.map((item) => (
				<InputBarFooterSlot key={item.id} open={Boolean(item.node)}>
					{item.node}
				</InputBarFooterSlot>
			))}
		</div>
	);
}
