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
 * 内容仍然按需挂载（没打开过就不在树里）：工具卡片里有 markdown 与 shiki 高亮，
 * 常驻挂载会把折叠的代价提前付掉。
 *
 * 收起分两步，见下面 `settled` 的说明——卸载一整棵工具卡片子树是一次很长的同步
 * 提交，压在动画收尾那一帧上就是肉眼可见的一顿。
 */

const DURATION_MS = 200;
/** 空闲期迟迟不来时的兜底：最多拖这么久也要把子树卸掉，别让 DOM 一直挂着。 */
const IDLE_UNMOUNT_TIMEOUT_MS = 2000;

type IdleHandle = { kind: "idle"; id: number } | { kind: "timeout"; id: number };

function scheduleIdle(callback: () => void): IdleHandle {
	if (typeof window.requestIdleCallback === "function") {
		return { kind: "idle", id: window.requestIdleCallback(callback, { timeout: IDLE_UNMOUNT_TIMEOUT_MS }) };
	}
	return { kind: "timeout", id: window.setTimeout(callback, IDLE_UNMOUNT_TIMEOUT_MS) };
}

function cancelIdle(handle: IdleHandle): void {
	if (handle.kind === "idle") window.cancelIdleCallback(handle.id);
	else window.clearTimeout(handle.id);
}

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
	// 首帧就是 open（导出态、forceExpanded）时直接落到展开态，不播入场动画，
	// 与原来的 `<AnimatePresence initial={false}>` 行为一致。
	const [mounted, setMounted] = useState(open);
	const [expanded, setExpanded] = useState(open);
	/**
	 * 折叠动画跑完 → 先 `display:none`。此时布局已经定稿（0fr 本来就是 0 高），
	 * 但子树不再参与布局与绘制；真正的 React 卸载挪到空闲期。
	 * 这样「收回」的最后一帧只剩一次样式变更，而不是一次上千节点的同步卸载。
	 */
	const [settled, setSettled] = useState(!open);
	const firstRunRef = useRef(true);
	const idleHandleRef = useRef<IdleHandle | null>(null);

	useEffect(() => {
		const cancelPendingUnmount = (): void => {
			if (!idleHandleRef.current) return;
			cancelIdle(idleHandleRef.current);
			idleHandleRef.current = null;
		};

		// 首帧的 state 就是目标状态，既不播动画也不排任何定时器——否则每个「初始收起」
		// 的面板都会在挂载时白排一个 200ms timer，工作模式一条消息几十行就是几十个。
		if (firstRunRef.current) {
			firstRunRef.current = false;
			return;
		}

		if (open) {
			cancelPendingUnmount();
			setMounted(true);
			setSettled(false);
			// 先以 0fr 挂载，下一帧再切 1fr，否则没有可过渡的起始值。
			const frame = requestAnimationFrame(() => setExpanded(true));
			return () => cancelAnimationFrame(frame);
		}

		setExpanded(false);
		const timer = window.setTimeout(() => {
			setSettled(true);
			idleHandleRef.current = scheduleIdle(() => {
				idleHandleRef.current = null;
				setMounted(false);
			});
		}, DURATION_MS);
		return () => {
			window.clearTimeout(timer);
			cancelPendingUnmount();
		};
	}, [open]);

	if (!mounted) return null;

	return (
		<div
			id={id}
			data-export-collapse-panel={exportPanel ? "" : undefined}
			hidden={hidden}
			// `[&[hidden]]:hidden`：`grid` 是作者样式，会盖过 UA 的 `[hidden]{display:none}`，
			// 所以导出态的 hidden 属性必须自己配一条规则。规则挂在属性上，导出脚本摘掉属性即可展开。
			className={`${settled ? "hidden" : "grid"} [&[hidden]]:hidden transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none ${
				expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
			}`}
		>
			<div className={`min-w-0 overflow-hidden ${contentClassName ?? ""}`}>{children}</div>
		</div>
	);
}
