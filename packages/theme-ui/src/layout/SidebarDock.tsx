import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";
import { useRef } from "react";
import { cn } from "@vetta-org/ui";

/**
 * 展开/收起的滑动时长（毫秒）。
 *
 * 同时是宿主延迟挂载重子树的时长，两处必须同源，否则一改时长，延迟挂载就会重新落回
 * 滑动中间。
 */
export const SIDEBAR_DOCK_ANIMATION_MS = 240;

export interface SidebarDockProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
	children: ReactNode;
	visible: boolean;
	/**
	 * 左栏宽度（px），与侧边栏面板自身的宽度同源（`sidebarWidthAtom`）。
	 *
	 * 必须显式给值、不能靠内容撑：抽屉式过渡要求布局宽度一步到位，而「按内容宽度」在
	 * 收起态量不到（面板已被移出占位盒子的尺寸计算）。
	 */
	width: number;
}

/**
 * 左栏的布局占位与展开/收起滑动。
 *
 * 这一层有三条性能约束，改动前先读完：
 *
 * 1. **布局只落一次，滑动走合成层。** 占位盒子的宽度在点击那一刻直接切到终值、不参与
 *    过渡，面板则脱离占位盒子用 `transform` 滑进滑出。原先是逐帧过渡宽度，主内容区因此
 *    被反复重排；而内容区里每一个 `ResizeObserver` 都会在每个布局步上各触发一次并带一次
 *    setState——插件的整页工作区视图（宫格列数、等比缩放预览、虚拟列表、图表）全靠它做
 *    自适应，一次收缩实测 156 次回调、long task 175ms。改成一步到位后回调只剩一次，
 *    且与视图里怎么写无关，第三方插件同样受益。
 *    代价是内容的自适应（宫格换列、文字换行）在点击瞬间完成，而不是跟着滑动渐变——抽屉
 *    动画的常规取舍。
 *
 * 2. **过渡纯 CSS**，不走 JS 动画：展开这一下主线程最忙，逐帧测量并写样式的动画第一个
 *    被挤掉。
 *
 * 3. **子树挂过一次就留在树上**，不随收起卸载。整棵子树重挂一次是约 150ms 的同步渲染，
 *    压在点击那一次 commit 里会把滑动的头几帧整段吃掉。
 *
 * 留住子树的代价必须还清：`inert` + `aria-hidden` 挡掉指针与 Tab（否则会多出一条看不见
 * 却能走进去的侧边栏）；`inert` 同时是「左栏不在位」的样式钩子——经典侧边栏贴边的负
 * margin、主内容左缘补色都据它判定，见 renderer/styles.css。
 *
 * 收起态还必须 `opacity-0`：占位盒子的左缘停在 AppFrame 的 8px 内边距上，面板按自身宽度
 * 滑出后右缘正好压在窗口最左那 8px 上（mac 经典侧边栏是半透明 tint + 右边框，会显成一条
 * 竖白条）。透明度跟着一起过渡，滑出过程照旧可见。
 */
export function SidebarDock({
	children,
	className,
	style,
	visible,
	width,
	...props
}: SidebarDockProps): JSX.Element {
	const mountedOnce = useRef(visible);
	if (visible) mountedOnce.current = true;
	return (
		<div
			// z-10：收起时面板要贴着已经铺开的内容区滑出去，不能被它盖住。
			className={cn("relative z-10 shrink-0 overflow-visible", className)}
			style={{ width: visible ? width : 0, ...style }}
			{...(visible ? {} : { inert: true, "aria-hidden": true })}
			{...props}
		>
			<div
				className={cn(
					"absolute inset-y-0 left-0 transition-[transform,opacity] ease-[cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none",
					visible ? "opacity-100" : "opacity-0",
				)}
				style={{
					width,
					transform: visible ? "translateX(0)" : `translateX(-${width}px)`,
					transitionDuration: `${SIDEBAR_DOCK_ANIMATION_MS}ms`,
				}}
			>
				{mountedOnce.current ? children : null}
			</div>
		</div>
	);
}
