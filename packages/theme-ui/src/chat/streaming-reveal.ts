/**
 * 流式文本的「逐短语淡入」节奏（参照 Gemini 网页端的实测行为）。
 *
 * - 显示单位是短语：在标点、换行处断开，过长的无标点片段按上限切开。
 * - 只显示已经写完的短语：尾部未完成的片段先藏着，避免已上屏的片段里再「长出」没有动画的字。
 * - 一次放出一个短语，积压越多间隔越短，快追平时逐渐放慢，结尾自然收住。
 * - 每个短语淡入时长远大于放出间隔，多个短语同时处在不同淡入进度，形成柔和的波。
 */

/** 积压很多时的最短放出间隔（≈3 帧）。 */
const MIN_REVEAL_INTERVAL_MS = 50;
/** 积压见底时的最长放出间隔。 */
const MAX_REVEAL_INTERVAL_MS = 300;
/** 间隔 ≈ 该值 / (剩余短语数 + 1)，剩余 1→200ms、3→100ms、7→50ms。 */
const REVEAL_INTERVAL_SCALE_MS = 400;
/** 积压超过这么多短语时一次放出多个，避免长积压（如切回正在流式的会话）拖成几十秒。 */
const MAX_QUEUED_PHRASES = 12;
/** 规划时最多向后数这么多个短语，只用于决定节奏，数多了没有意义。 */
const PLAN_LOOKAHEAD_PHRASES = 64;
/** 无标点长片段的切分上限（UTF-16 code units）。 */
const MAX_PHRASE_LENGTH = 48;
/** 按上限切分时，优先在这个长度之后的最后一个空白处断开。 */
const MIN_SOFT_BREAK_LENGTH = 16;

/** 淡入时长，与 `.streaming-chunk` 的 CSS 保持一致。 */
const STREAMING_FADE_MS = 400;
/** 最后一个短语放出后，等淡入播完再撤掉分段 span。 */
export const STREAMING_SETTLE_MS = STREAMING_FADE_MS + 50;
/** 尾部未完成片段超过这么久没有新内容，就不再等标点，直接放出，避免模型停顿时文字「卡住」。 */
export const STREAMING_STALL_FLUSH_MS = 800;

const CJK_BREAK = new Set(["，", "。", "；", "：", "！", "？", "、", "…"]);
const CJK_TRAILING = new Set(["，", "。", "；", "：", "！", "？", "、", "…", "”", "’", "）", "」", "』", "》", "】"]);
const LATIN_BREAK = new Set([",", ".", ";", ":", "!", "?"]);
const WHITESPACE = /\s/;

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

/**
 * 从 `from` 开始的下一个短语的结束位置；尾部还没写完时返回 null。
 * `final` 表示文本不会再增长，此时末尾剩余内容也算一个完整短语。
 */
export function nextPhraseEnd(text: string, from: number, final: boolean): number | null {
	const length = text.length;
	if (from >= length) return null;

	for (let index = from; index < length; index++) {
		const char = text[index] as string;
		if (char === "\n") return index + 1;

		if (CJK_BREAK.has(char)) {
			let end = index + 1;
			while (end < length && CJK_TRAILING.has(text[end] as string)) end++;
			return end;
		}

		// 英文标点只有后面跟着空白才算断句：`3.14`、`e.g.x`、URL 里的点都不断开；
		// 标点正好在末尾时还不知道后面是什么，先当作未完成。
		if (LATIN_BREAK.has(char)) {
			if (index + 1 < length) {
				if (WHITESPACE.test(text[index + 1] as string)) return index + 1;
			} else if (!final) {
				return null;
			}
		}

		if (index + 1 - from >= MAX_PHRASE_LENGTH) {
			for (let back = index; back >= from + MIN_SOFT_BREAK_LENGTH; back--) {
				if (WHITESPACE.test(text[back] as string)) return back;
			}
			return isHighSurrogate(text.charCodeAt(index)) ? index + 2 : index + 1;
		}
	}

	return final ? length : null;
}

/** 把一段文本切成可逐个淡入的短语；拼接结果恒等于输入，文本末尾总是结束最后一个短语。 */
export function splitStreamingSegments(value: string): string[] {
	const segments: string[] = [];
	for (let start = 0; start < value.length; ) {
		const end = nextPhraseEnd(value, start, true) ?? value.length;
		segments.push(value.slice(start, end));
		start = end;
	}
	return segments;
}

export interface RevealStep {
	/** 本次应显示到的位置。 */
	end: number;
	/** 距离下一次放出至少要等待的时间。 */
	delayMs: number;
}

/** 规划下一次放出；没有完整短语可放时返回 null。 */
export function planReveal(text: string, revealed: number, final: boolean): RevealStep | null {
	const ends: number[] = [];
	for (let cursor = revealed; ends.length < PLAN_LOOKAHEAD_PHRASES; ) {
		const end = nextPhraseEnd(text, cursor, final);
		if (end === null) break;
		ends.push(end);
		cursor = end;
	}
	if (ends.length === 0) return null;

	const step = Math.max(1, Math.ceil(ends.length / MAX_QUEUED_PHRASES));
	const remaining = ends.length - step;
	const delayMs = Math.min(
		MAX_REVEAL_INTERVAL_MS,
		Math.max(MIN_REVEAL_INTERVAL_MS, Math.round(REVEAL_INTERVAL_SCALE_MS / (remaining + 1))),
	);
	return { end: ends[step - 1] as number, delayMs };
}
