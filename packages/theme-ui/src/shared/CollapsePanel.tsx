import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";

/**
 * 折叠面板：CSS `grid-template-rows: 0fr → 1fr` 过渡，取代 framer-motion 的
 * `height: 0 → auto`。
 *
 * 为什么换：motion 的 height:auto 是 JS 驱动的——每帧回到主线程写一次内联
 * height，再触发一次强制样式重算。消息列表跑在 Virtuoso 上，外层
 * ResizeObserver 会把这每一帧的尺寸变化都变成一次列表重测量，同时滚动跟随的
 * rAF 也在读布局。低配机上三者叠在同一帧里，展开就明显掉帧。CSS 过渡走浏览器
 * 自己的动画时间线，不占主线程 JS，也不经过 React 协调。
 *
 * 内容仍然按需挂载（收起时不在树里），这点必须与原 `AnimatePresence` 一致：
 * 工具卡片里有 markdown 与 shiki 高亮，常驻挂载会把折叠的代价提前付掉。
 */

const DURATION_MS = 200;

export interface CollapsePanelProps {
	open: boolean;
	children: ReactNode;
	/** 面板容器 id（导出流程按 id 找面板）。 */
	id?: string;
	/** 导出流程的标记属性；`undefined` 时不落到 DOM 上。 */
	exportPanel?: boolean;
	/** 导出态下折叠的面板保留在 DOM 里但 `hidden`。 */
	hidden?: boolean;
	/** 内层内容容器的额外类名。 */
	contentClassName?: string;
}

export function CollapsePanel({
	open,
	children,
	id,
	exportPanel = false,
	hidden = false,
	contentClassName,
}: CollapsePanelProps): JSX.Element | null {
	// 首帧就是 open（导出态、forceExpanded）时直接落到展开态，不播入场动画,
	// 与原来的 `<AnimatePresence initial={false}>` 行为一致。
	const [mounted, setMounted] = useState(open);
	const [expanded, setExpanded] = useState(open);
	const firstRunRef = useRef(true);

	useEffect(() => {
		if (firstRunRef.current) {
			firstRunRef.current = false;
			if (open) return;
		}
		if (open) {
			setMounted(true);
			// 先以 0fr 挂载，下一帧再切 1fr，否则没有可过渡的起始值。
			const frame = requestAnimationFrame(() => setExpanded(true));
			return () => cancelAnimationFrame(frame);
		}
		setExpanded(false);
		const timer = window.setTimeout(() => setMounted(false), DURATION_MS);
		return () => window.clearTimeout(timer);
	}, [open]);

	if (!mounted) return null;

	return (
		<div
			id={id}
			data-export-collapse-panel={exportPanel ? "" : undefined}
			hidden={hidden}
			className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none ${
				expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
			}`}
		>
			<div className={`min-w-0 overflow-hidden ${contentClassName ?? ""}`}>{children}</div>
		</div>
	);
}
