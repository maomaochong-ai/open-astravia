import { SurfaceActiveContext } from "@shared/surface-active";
import { Activity, useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import {
	deferredSurfacePhase,
	deferredSurfaceRootClassName,
	shouldStartStackLeave,
} from "./deferred-surface-display";

/**
 * VS Code 工作台 / Cursor 侧栏同款：第一次走进才挂载，切走用 React 19.2
 * `<Activity mode="hidden">` 隐藏而不是卸树。DOM、滚动和局部 state 保留；
 * Effects 拆除，避免后台页继续抢主线程。
 *
 * 默认宿主带 HTML `hidden`，不占 flex 空间。工作台主表面打开 `stackLeave` 后，
 * 离场先 `absolute inset-0` 叠一帧（入场立刻占 flex-1），下一帧再 hidden。
 */
export interface DeferredSurfaceProps {
	active: boolean;
	children: ReactNode;
	name: string;
	/**
	 * 父级已经决定要保活时，即使还没走进也预挂隐藏树。
	 * 设置标签等「列表里先占位、点到才挂」的入口不要开。
	 */
	premount?: boolean;
	/**
	 * 从可见切到不可见时，先脱离文档流叠最后一帧，再 hidden。
	 * 工作台主表面打开；设置标签保持立刻 hidden，避免两栏抢 flex。
	 */
	stackLeave?: boolean;
}

export function DeferredSurface({
	active,
	children,
	name,
	premount = false,
	stackLeave = false,
}: DeferredSurfaceProps): JSX.Element | null {
	const [visited, setVisited] = useState(active || premount);
	const [leaving, setLeaving] = useState(false);
	const [prevActive, setPrevActive] = useState(active);
	const rootRef = useRef<HTMLDivElement>(null);

	if ((active || premount) && !visited) setVisited(true);

	if (active !== prevActive) {
		setPrevActive(active);
		if (shouldStartStackLeave(active, stackLeave, prevActive)) {
			setLeaving(true);
		} else if (active || leaving) {
			setLeaving(false);
		}
	}
	if (!stackLeave && leaving) setLeaving(false);

	const startLeave = shouldStartStackLeave(active, stackLeave, prevActive);
	const phase = deferredSurfacePhase({ active, leaving: leaving || startLeave });

	useEffect(() => {
		if (active) return;
		const root = rootRef.current;
		const focused = document.activeElement;
		if (root && focused instanceof HTMLElement && root.contains(focused)) {
			focused.blur();
		}
	}, [active]);

	useEffect(() => {
		if (!leaving || active) return;
		const frame = requestAnimationFrame(() => {
			setLeaving(false);
		});
		return () => cancelAnimationFrame(frame);
	}, [active, leaving]);

	if (!visited) return null;

	const hidden = phase === "hidden";

	return (
		<SurfaceActiveContext.Provider value={active}>
			<div
				ref={rootRef}
				hidden={hidden}
				{...(phase !== "visible" ? { inert: true } : {})}
				className={deferredSurfaceRootClassName(phase)}
			>
				<Activity mode={hidden ? "hidden" : "visible"} name={name}>
					{children}
				</Activity>
			</div>
		</SurfaceActiveContext.Provider>
	);
}
