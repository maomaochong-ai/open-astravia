import type { CSSProperties, JSX } from "react";
import { useCallback, useEffect, useState } from "react";

/** 卡片内滚动窗口高度（px），约 3 行正文。 */
const VIEWPORT_HEIGHT = 64;
/** 上下渐隐高度（px）。 */
const FADE_SIZE = 16;
/** 每帧向目标位置逼近的比例，越小拖尾越长。 */
const SCROLL_EASING = 0.14;

function prefersReducedMotion(): boolean {
	return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 思考文本追加时缓动追随底部。只在 `text` 变化后跑 rAF，追上目标即停，
 * 不再整段思考期间无限 `requestAnimationFrame`。
 */
function useTrailingScrollToBottom(el: HTMLDivElement | null, text: string): boolean {
	const [overflowing, setOverflowing] = useState(false);

	useEffect(() => {
		if (!el) {
			setOverflowing(false);
			return;
		}

		const reduced = prefersReducedMotion();
		let cancelled = false;
		let frame = 0;
		const step = (): void => {
			if (cancelled) return;
			const target = el.scrollHeight - el.clientHeight;
			setOverflowing((prev) => {
				const next = target > 1;
				return prev === next ? prev : next;
			});
			if (reduced) {
				el.scrollTop = target;
				return;
			}
			const delta = target - el.scrollTop;
			if (Math.abs(delta) < 0.5) {
				el.scrollTop = target;
				return;
			}
			el.scrollTop += delta * SCROLL_EASING;
			frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => {
			cancelled = true;
			cancelAnimationFrame(frame);
		};
	}, [el, text]);

	return overflowing;
}

export interface LiveThinkingViewProps {
	/** 正在追加的思考正文。 */
	readonly text: string;
}

/**
 * 正在进行中的思考卡片：渲染在该 thinking block 原本所在的位置（可能在某个阶段组内），
 * 正文在卡片内的固定高度窗口里随流式内容缓动上滚、上下边缘渐隐。思考结束后由宿主
 * 换回原位的折叠条。
 *
 * 入场用 CSS `grid-template-rows` 过渡，避免 motion 的 `height: auto` 每帧写内联高度、
 * 再触发消息列表 ResizeObserver。
 */
export function LiveThinkingView({ text }: LiveThinkingViewProps): JSX.Element {
	const [el, setEl] = useState<HTMLDivElement | null>(null);
	const [expanded, setExpanded] = useState(false);
	const setRef = useCallback((node: HTMLDivElement | null) => setEl(node), []);
	const overflowing = useTrailingScrollToBottom(el, text);

	useEffect(() => {
		const frame = requestAnimationFrame(() => setExpanded(true));
		return () => cancelAnimationFrame(frame);
	}, []);

	const maskImage = overflowing
		? `linear-gradient(to bottom, transparent 0, black ${FADE_SIZE}px, black calc(100% - ${FADE_SIZE}px), transparent 100%)`
		: undefined;
	const viewportStyle: CSSProperties = {
		maxHeight: VIEWPORT_HEIGHT,
		...(maskImage ? { WebkitMaskImage: maskImage, maskImage } : undefined),
	};

	return (
		<div
			className={`grid overflow-hidden pt-1 transition-[grid-template-rows,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
				expanded ? "grid-rows-[1fr] translate-y-0 opacity-100" : "grid-rows-[0fr] translate-y-2 opacity-0"
			}`}
		>
			<div className="min-h-0 overflow-hidden">
				<div
					ref={setRef}
					className="min-w-0 max-w-full overflow-hidden rounded-xl bg-muted/25 px-3 py-2"
					style={viewportStyle}
				>
					<div className="whitespace-pre-wrap break-words text-[12px] leading-[1.6] text-muted-foreground/55">
						{text}
					</div>
				</div>
			</div>
		</div>
	);
}
