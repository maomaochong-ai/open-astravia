import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";
import { useRef } from "react";
import { cn } from "@vetta-org/ui";

/**
 * 展开/收起的过渡时长（毫秒）。
 *
 * 同时是 CSS 过渡时长与宿主的延迟挂载时长：侧边栏内部的重子树（虚拟列表、项目行、各种
 * 菜单）首次挂载要排到过渡之后，两处必须同源，否则一改时长，延迟挂载就会重新落回过渡中间。
 */
export const SIDEBAR_DOCK_ANIMATION_MS = 240;

export interface SidebarDockProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
	children: ReactNode;
	visible: boolean;
}

/**
 * 左栏的占位与展开/收起过渡。
 *
 * 两条都是这里的性能前提，改动前先读完：
 *
 * 1. 过渡纯 CSS（`grid-template-columns` 0fr↔1fr，与项目组折叠同一套路），不走 JS 动画。
 *    JS 动画每帧都要在主线程上测量并写样式，而展开这一下恰好是主线程最忙的时刻，动画
 *    因此第一个被挤掉。CSS 过渡由合成/样式系统自己推进，主线程偶尔卡一下也不掉帧。
 *    宽度用 fr 而不是 `auto`：CSS 过渡不了 `auto`，而 0fr↔1fr 在宽度 auto 的容器里
 *    正好等价（1fr 解析到 max-content）。
 *
 * 2. 子树挂过一次就留在树上，不随收起卸载。侧边栏整棵子树重新挂载一次是约 150ms 的同步
 *    渲染，压在点击那一次 commit 里会把展开过渡的头几帧整段吃掉——观感是侧边栏「一顿一顿」
 *    地出来，而过渡本身其实是平滑的。
 *
 * 留住子树的代价必须还清：`inert` + `aria-hidden` 挡掉指针与 Tab（否则会多出一条看不见
 * 却能走进去的侧边栏）；`inert` 同时是「左栏不在位」的样式钩子——收起态它仍是 0 宽的流内
 * 盒子，依赖它的规则（经典侧边栏贴边的负 margin、主内容的左缘补色）都据此判定。
 */
export function SidebarDock({
	children,
	className,
	style,
	visible,
	...props
}: SidebarDockProps): JSX.Element {
	const mountedOnce = useRef(visible);
	if (visible) mountedOnce.current = true;
	return (
		<div
			className={cn(
				"grid transition-[grid-template-columns,opacity,margin-left] ease-[cubic-bezier(0.22,0.61,0.36,1)]",
				visible ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0",
				className,
			)}
			style={{ transitionDuration: `${SIDEBAR_DOCK_ANIMATION_MS}ms`, ...style }}
			{...(visible ? {} : { inert: true, "aria-hidden": true })}
			{...props}
		>
			{/* min-w-0：没有它，侧边栏的 min-content 宽度会把 0fr 那条轨道顶开。
			    展开态要 overflow-visible：侧边栏里的浮层与阴影本来就故意溢出左栏。 */}
			<div className={cn("min-w-0", visible ? "overflow-visible" : "overflow-hidden")}>
				{mountedOnce.current ? children : null}
			</div>
		</div>
	);
}
