import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HastElement, HastRoot, HastText } from "./nodes";
import {
	DEFAULT_RATE_PER_MS,
	planReveal,
	REVEAL_TICK_MS,
	STREAMING_IDLE_SETTLE_MS,
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
						visit(child, inCode || tag === "code" || tag === "pre" || tag === "table" || tag === "astravia-svg");
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
 * 逐字 reveal 的长度上限。超过这个长度（上下文压缩摘要能到 20k–72k 字符）不再逐字推进：
 * reveal 每 100ms 推进一次就等于把整篇 markdown 重新解析、重新提交一次，长文本压缩卡片
 * 在这条路径上会把渲染推成嵌套更新循环（React error #185，Maximum update depth exceeded）。
 * 旁路后仍然走快照节流，长文本按帧到达而不是逐字浮现。
 */
export const STREAM_ANIMATE_MAX_CHARS = 12_000;

/** 这段尾块是否走逐字 reveal：流式中，且文本没超过上限。 */
export function shouldRevealStreamingTail(text: string, isStreamingTail: boolean): boolean {
	return isStreamingTail && text.length <= STREAM_ANIMATE_MAX_CHARS;
}

/** 超过这个长度先按 200ms 节流，再超过大阈值放宽到 400ms。 */
export const STREAM_RENDER_INTERVAL_SMALL_CHARS = 12_000;
export const STREAM_RENDER_INTERVAL_LARGE_CHARS = 50_000;

/**
 * 流式渲染的节流间隔。
 *
 * 只看尾块长度不工作：尾块是“最后一个空行之后的部分”，写一段就归零、写完一段又长回来，所以它大多时候很小，
 * 间隔实际几乎一直是 0——拿一份真实的 52k 压缩摘要模拟 130 次增量，旧规则只有 14 次开了节流，其余 89% 仍是无节流的整篇解析，
 * 正是 #185 需要的压力。整体长度在流式期间只增不减，用它兜底后间隔一旦抬上去就不再落回；
 * 短回复（整体也不长）仍然即时渲染，保持逐字手感。
 */
export function resolveStreamRenderInterval(streamLength: number, tailLength: number): number {
	const longest = Math.max(streamLength, tailLength);
	if (longest >= STREAM_RENDER_INTERVAL_LARGE_CHARS) return 400;
	if (longest >= STREAM_RENDER_INTERVAL_SMALL_CHARS) return 200;
	return 0;
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

	/** 已追平但流未结束：静默一会儿后只撤暗色，保留 streamedRef，新文本到达时布局效果会重新挂上。 */
	const settleIdle = useCallback((): void => {
		if (settleTimerRef.current !== null) return;
		settleTimerRef.current = window.setTimeout(() => {
			settleTimerRef.current = null;
			setAnimateChunks(false);
		}, STREAMING_IDLE_SETTLE_MS);
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
			} else {
				settleIdle();
			}
		},
		[settle, settleIdle],
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
		// 只在有新内容要放时挂暗色：空闲撤暗后回合才结束（文本没变）时不能再暗一下。
		if (textChanged || shown.length < text.length) setAnimateChunks(true);
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
