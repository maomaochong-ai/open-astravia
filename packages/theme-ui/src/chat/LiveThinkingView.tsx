import { AnimatePresence, motion } from "motion/react";
import type { Transition } from "motion/react";
import type { CSSProperties, JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMinimumVisible } from "../shared/useMinimumVisible";

/** 卡片内滚动窗口高度（px），约 3 行正文。 */
const VIEWPORT_HEIGHT = 64;
/** 上下渐隐高度（px）。 */
const FADE_SIZE = 16;
/** 每帧向目标位置逼近的比例，越小拖尾越长。 */
const SCROLL_EASING = 0.14;
/** 卡片最短可见时长（ms）：模型吐字太快时也不至于一闪而过。 */
const MIN_VISIBLE_MS = 1500;

/** 入场/出场：从零高度展开并轻微上浮，收起时反向。 */
const CARD_INITIAL = { opacity: 0, height: 0, y: 8 };
const CARD_ANIMATE = { opacity: 1, height: "auto", y: 0 };
const CARD_EXIT = { opacity: 0, height: 0, y: -6 };
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

interface LiveThinkingCardProps {
	readonly text: string;
}

function LiveThinkingCard({ text }: LiveThinkingCardProps): JSX.Element {
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
		<div
			ref={setRef}
			className="min-w-0 max-w-full overflow-hidden rounded-xl bg-muted/25 px-3 py-2"
			style={viewportStyle}
		>
			<div className="whitespace-pre-wrap break-words text-[12px] leading-[1.6] text-muted-foreground/55">
				{text}
			</div>
		</div>
	);
}

export interface LiveThinkingViewProps {
	/** 当前正在追加 thinking：true 时展示卡片，转 false 满足最短可见时长后播放出场动画。 */
	readonly active: boolean;
	readonly text: string;
}

/**
 * 正在进行中的思考卡片：无论它在消息里属于哪个（可能已折叠的）阶段组，都提升到
 * 消息末尾常驻展示，正文在卡片内的固定高度窗口里自动上滚。思考结束后由宿主把
 * active 置为 false，卡片满足最短可见时长再播出场动画消失，内容回到原位的折叠条。
 */
export function LiveThinkingView({ active, text }: LiveThinkingViewProps): JSX.Element {
	const visible = useMinimumVisible(active, MIN_VISIBLE_MS);
	// 收尾停留期间宿主已经不再供给文本，沿用最后一段思考，避免卡片瞬间空掉。
	const lastTextRef = useRef(text);
	if (active) lastTextRef.current = text;

	return (
		<AnimatePresence initial={false}>
			{visible && (
				<motion.div
					key="live-thinking"
					className="overflow-hidden pt-1"
					initial={CARD_INITIAL}
					animate={CARD_ANIMATE}
					exit={CARD_EXIT}
					transition={CARD_TRANSITION}
				>
					<LiveThinkingCard text={active ? text : lastTextRef.current} />
				</motion.div>
			)}
		</AnimatePresence>
	);
}
