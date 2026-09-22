import { useCallback, useEffect, useRef, useState } from "react";
import type { HastElement, HastRoot, HastText } from "./nodes";
import { planReveal, STREAMING_SETTLE_MS, STREAMING_STALL_FLUSH_MS, splitStreamingSegments } from "./streaming-reveal";

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
						visit(child, inCode || tag === "code" || tag === "pre" || tag === "table");
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

/**
 * 流式尾块：按短语把显示文本追向宿主文本，配合 rehype 分段做逐短语淡入（节奏见 streaming-reveal）。
 * 尾部没写完的片段先不显示；尾块结束后继续按节奏放完剩余短语，再撤掉分段。
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
	/** 尾部停顿太久：不再等标点，把未完成片段也当作可放出的短语。 */
	const stalledRef = useRef(false);
	const nextRevealAtRef = useRef(0);
	const revealTimerRef = useRef<number | null>(null);
	const stallTimerRef = useRef<number | null>(null);
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
			revealTimerRef.current = null;
			const target = targetRef.current;
			const final = !activeRef.current || stalledRef.current;
			const step = planReveal(target, displayRef.current.length, final);
			if (!step) {
				if (!activeRef.current) settle();
				return;
			}
			const next = target.slice(0, step.end);
			displayRef.current = next;
			setDisplayText(next);
			nextRevealAtRef.current = Date.now() + step.delayMs;
			revealTimerRef.current = window.setTimeout(reveal, step.delayMs);
		},
		[settle],
	);

	const scheduleReveal = useCallback((): void => {
		if (revealTimerRef.current !== null) return;
		revealTimerRef.current = window.setTimeout(reveal, Math.max(0, nextRevealAtRef.current - Date.now()));
	}, [reveal]);

	useEffect(
		() => () => {
			clearTimeoutRef(revealTimerRef);
			clearTimeoutRef(stallTimerRef);
			clearTimeoutRef(settleTimerRef);
		},
		[],
	);

	useEffect(() => {
		const textChanged = targetRef.current !== text;
		targetRef.current = text;
		activeRef.current = active;
		if (active) streamedRef.current = true;

		const shown = displayRef.current;
		if (!streamedRef.current || !text.startsWith(shown)) {
			// 从未流式过，或宿主改写了已显示内容（不是追加）：直接对齐，不做节奏。
			clearTimeoutRef(revealTimerRef);
			clearTimeoutRef(stallTimerRef);
			clearTimeoutRef(settleTimerRef);
			stalledRef.current = false;
			displayRef.current = text;
			setDisplayText(text);
			setAnimateChunks(false);
			streamedRef.current = active;
			return;
		}

		clearTimeoutRef(settleTimerRef);
		setAnimateChunks(true);
		if (textChanged) stalledRef.current = false;
		clearTimeoutRef(stallTimerRef);
		if (active && shown.length < text.length) {
			stallTimerRef.current = window.setTimeout(() => {
				stallTimerRef.current = null;
				stalledRef.current = true;
				scheduleReveal();
			}, STREAMING_STALL_FLUSH_MS);
		}
		scheduleReveal();
	}, [text, active, scheduleReveal]);

	return { displayText, animateChunks };
}
