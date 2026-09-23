import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HastElement, HastRoot, HastText } from "./nodes";
import {
	DEFAULT_RATE_PER_MS,
	planReveal,
	REVEAL_TICK_MS,
	STREAMING_SETTLE_MS,
	STREAMING_STALL_FLUSH_MS,
	splitStreamingSegments,
} from "./streaming-reveal";

const WHITESPACE_ONLY = /^\s+$/;

/**
 * 把流式尾块的正文按短语包成 `.streaming-chunk`，最新的两个短语再加 `-latest` / `-recent`：
 * 宿主 CSS 让它们略暗，下一次放出短语时随重渲染一起变亮。不用 CSS 淡入动画——每个短语各跑一段
 * 动画意味着流式全程连续出帧，毛玻璃窗口每帧都要整窗重合成；这样亮度只随放出节奏变，不多一帧。
 */
export function rehypeStreamingChunks() {
	return (tree: HastRoot): void => {
		const chunks: HastElement[] = [];
		function visit(node: HastRoot | HastElement, inCode: boolean): void {
			const newChildren: Array<(typeof node.children)[number]> = [];
			for (const child of node.children) {
				if (child.type === "text" && !inCode) {
					for (const segment of splitStreamingSegments((child as HastText).value)) {
						if (WHITESPACE_ONLY.test(segment)) {
							newChildren.push({ type: "text", value: segment } as HastText);
							continue;
						}
						const chunk: HastElement = {
							type: "element",
							tagName: "span",
							properties: { className: ["streaming-chunk"] },
							children: [{ type: "text", value: segment } as HastText],
						};
						chunks.push(chunk);
						newChildren.push(chunk);
					}
				} else {
					newChildren.push(child);
					if (child.type === "element") {
						const tag = child.tagName;
						// 表格也当字面量：单元格文字被拆成片段再逐步增长会反复触发列宽重算，
						// 流式期表格会抖动。
						visit(child, inCode || tag === "code" || tag === "pre" || tag === "table" || tag === "vetta-svg");
					}
				}
			}
			node.children = newChildren as typeof node.children;
		}

		visit(tree, false);
		const latest = chunks.at(-1);
		const recent = chunks.at(-2);
		if (latest) latest.properties = { className: ["streaming-chunk", "streaming-chunk-latest"] };
		if (recent) recent.properties = { className: ["streaming-chunk", "streaming-chunk-recent"] };
	};
}

interface StreamingDisplayState {
	displayText: string;
	animateChunks: boolean;
}

function clearTimeoutRef(ref: { current: number | null }): void {
	if (ref.current !== null) {
		window.clearTimeout(ref.current);
		ref.current = null;
	}
}

/** 到达速率的采样窗口：只看最近这么久。 */
const RATE_WINDOW_MS = 1500;

interface ArrivalSample {
	readonly at: number;
	readonly length: number;
}

/** 最近窗口内的到达速率（字符/毫秒）；样本不够时用默认值。 */
function estimateRate(samples: readonly ArrivalSample[], now: number): number {
	const first = samples.find((sample) => now - sample.at <= RATE_WINDOW_MS) ?? samples[0];
	const last = samples.at(-1);
	if (!first || !last || last.at - first.at < 50 || last.length <= first.length) return DEFAULT_RATE_PER_MS;
	return (last.length - first.length) / (last.at - first.at);
}

/**
 * 流式尾块：把显示文本匀速追向宿主文本（节奏见 streaming-reveal），配合 rehype 分段做「最新短语略暗」。
 * 放出由 `text` 变化（宿主每 100ms 一次的增量刷新）驱动，在布局效果里同步更新，与那次渲染落在同一帧；
 * 没有新文本时由兜底 tick 收尾。尾部未写完的词、未闭合的行内语法先扣着；流结束后按节奏放完再撤掉分段。
 *
 * 从未作为尾块流式过的实例（历史消息、产品故事等由宿主自己驱动逐字的场景）直接镜像 `text`。
 */
export function useStreamingDisplayText(text: string, active: boolean): StreamingDisplayState {
	const [displayText, setDisplayText] = useState(() => (active ? "" : text));
	const [animateChunks, setAnimateChunks] = useState(active);
	const displayRef = useRef(active ? "" : text);
	const targetRef = useRef(text);
	const activeRef = useRef(active);
	const streamedRef = useRef(active);
	const samplesRef = useRef<ArrivalSample[]>([]);
	/** 显示文本上次实际推进的时间：扣留、等词写完期间预算按它累计，闭合后能一次放出整段。 */
	const lastAdvanceAtRef = useRef(0);
	const lastArrivalAtRef = useRef(0);
	/** 扣留开始的时间；null 表示当前没有扣留。 */
	const heldSinceRef = useRef<number | null>(null);
	const tickTimerRef = useRef<number | null>(null);
	const settleTimerRef = useRef<number | null>(null);

	const settle = useCallback((): void => {
		if (settleTimerRef.current !== null) return;
		settleTimerRef.current = window.setTimeout(() => {
			settleTimerRef.current = null;
			streamedRef.current = false;
			setAnimateChunks(false);
		}, STREAMING_SETTLE_MS);
	}, []);

	const reveal = useCallback(
		function reveal(): void {
			clearTimeoutRef(tickTimerRef);
			const now = Date.now();
			const target = targetRef.current;
			const shown = displayRef.current.length;
			const final = !activeRef.current;
			const stalled = !final && now - lastArrivalAtRef.current >= STREAMING_STALL_FLUSH_MS;
			const step = planReveal({
				text: target,
				revealed: shown,
				final,
				ratePerMs: estimateRate(samplesRef.current, now),
				elapsedMs: lastAdvanceAtRef.current ? now - lastAdvanceAtRef.current : REVEAL_TICK_MS,
				stalled,
				heldMs: heldSinceRef.current === null ? 0 : now - heldSinceRef.current,
			});
			if (step?.held) heldSinceRef.current ??= now;
			else heldSinceRef.current = null;
			if (step && step.end > shown) {
				const next = target.slice(0, step.end);
				displayRef.current = next;
				setDisplayText(next);
				lastAdvanceAtRef.current = now;
			}
			if (displayRef.current.length >= target.length) lastAdvanceAtRef.current = now;
			if (displayRef.current.length < target.length) {
				tickTimerRef.current = window.setTimeout(reveal, REVEAL_TICK_MS);
			} else if (final) {
				settle();
			}
		},
		[settle],
	);

	useEffect(
		() => () => {
			clearTimeoutRef(tickTimerRef);
			clearTimeoutRef(settleTimerRef);
		},
		[],
	);

	// 用布局效果：放出后的 setState 会在浏览器绘制前同步重渲染，与宿主那次增量刷新落在同一帧。
	useLayoutEffect(() => {
		const textChanged = targetRef.current !== text;
		targetRef.current = text;
		activeRef.current = active;
		if (active) streamedRef.current = true;

		const shown = displayRef.current;
		if (!streamedRef.current || !text.startsWith(shown)) {
			// 从未流式过，或宿主改写了已显示内容（不是追加）：直接对齐，不做节奏。
			clearTimeoutRef(tickTimerRef);
			clearTimeoutRef(settleTimerRef);
			samplesRef.current = [];
			heldSinceRef.current = null;
			displayRef.current = text;
			setDisplayText(text);
			setAnimateChunks(false);
			streamedRef.current = active;
			return;
		}

		clearTimeoutRef(settleTimerRef);
		setAnimateChunks(true);
		const now = Date.now();
		if (textChanged || lastArrivalAtRef.current === 0) {
			lastArrivalAtRef.current = now;
			const samples = samplesRef.current.filter((sample) => now - sample.at <= RATE_WINDOW_MS);
			samples.push({ at: now, length: text.length });
			samplesRef.current = samples;
		}
		reveal();
	}, [text, active, reveal]);

	return { displayText, animateChunks };
}
