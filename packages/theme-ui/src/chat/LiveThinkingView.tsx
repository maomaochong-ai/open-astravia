import { motion } from "motion/react";
import type { Transition } from "motion/react";
import type { CSSProperties, JSX } from "react";
import { useCallback, useEffect, useState } from "react";

/** 卡片内滚动窗口高度（px），约 3 行正文。 */
const VIEWPORT_HEIGHT = 64;
/** 上下渐隐高度（px）。 */
const FADE_SIZE = 16;
/** 每帧向目标位置逼近的比例，越小拖尾越长。 */
const SCROLL_EASING = 0.14;

/** 入场：从零高度展开并轻微上浮。 */
const CARD_INITIAL = { opacity: 0, height: 0, y: 8 };
const CARD_ANIMATE = { opacity: 1, height: "auto", y: 0 };
const CARD_TRANSITION = {
	duration: 0.32,
	ease: [0.22, 1, 0.36, 1] as const,
} satisfies Transition;

function prefersReducedMotion(): boolean {
	return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 让滚动容器持续缓动追随内容底部：思考文本每次追加都会拉长内容，
 * rAF 逐帧逼近目标位置，形成连续上滚而不是逐段跳变。
 */
function useTrailingScrollToBottom(el: HTMLDivElement | null): boolean {
	const [overflowing, setOverflowing] = useState(false);

	useEffect(() => {
		if (!el) {
			setOverflowing(false);
			return;
		}

		const reduced = prefersReducedMotion();
		let frame = requestAnimationFrame(function step() {
			const target = el.scrollHeight - el.clientHeight;
			setOverflowing((prev) => {
				const next = target > 1;
				return prev === next ? prev : next;
			});
			if (reduced) {
				el.scrollTop = target;
			} else {
				const delta = target - el.scrollTop;
				el.scrollTop = Math.abs(delta) < 0.5 ? target : el.scrollTop + delta * SCROLL_EASING;
			}
			frame = requestAnimationFrame(step);
		});

		return () => cancelAnimationFrame(frame);
	}, [el]);

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
 */
export function LiveThinkingView({ text }: LiveThinkingViewProps): JSX.Element {
	const [el, setEl] = useState<HTMLDivElement | null>(null);
	const setRef = useCallback((node: HTMLDivElement | null) => setEl(node), []);
	const overflowing = useTrailingScrollToBottom(el);

	// 内容不足一屏时不加遮罩，否则首行会被无谓地压暗。
	const maskImage = overflowing
		? `linear-gradient(to bottom, transparent 0, black ${FADE_SIZE}px, black calc(100% - ${FADE_SIZE}px), transparent 100%)`
		: undefined;
	const viewportStyle: CSSProperties = {
		maxHeight: VIEWPORT_HEIGHT,
		...(maskImage ? { WebkitMaskImage: maskImage, maskImage } : undefined),
	};

	return (
		<motion.div
			className="overflow-hidden pt-1"
			initial={CARD_INITIAL}
			animate={CARD_ANIMATE}
			transition={CARD_TRANSITION}
		>
			<div
				ref={setRef}
				className="min-w-0 max-w-full overflow-hidden rounded-xl bg-muted/25 px-3 py-2"
				style={viewportStyle}
			>
				<div className="whitespace-pre-wrap break-words text-[12px] leading-[1.6] text-muted-foreground/55">
					{text}
				</div>
			</div>
		</motion.div>
	);
}
