/**
 * 流式文本的「匀速放出」节奏。
 *
 * - 显示单位是片：按最近到达速率算出本 tick 该放多少字，再对齐到词边界（拉丁词不从中间切开，
 *   CJK 逐字即边界），快时是密而匀的流，慢时自然放慢，不再按积压成批砸出。
 * - 放出由宿主的增量刷新驱动（每次新文本到达放一片），没有新文本时由 100ms 兜底 tick 收尾，
 *   页面每秒的更新次数与增量刷新一致，不多出帧。
 * - 未闭合的行内语法（`[链接](…)`、行内代码、加粗）先扣着不放，闭合后整体出现，
 *   避免先看到原始标记再翻转成徽标；扣太久或太长就当普通文字放出。
 * - 尾部未写完的词先不显示；停顿太久就不再等。
 * - 分段给 rehype 用的短语切分（`splitStreamingSegments`）保持按标点切，供「最新短语略暗」使用。
 */

/** 放出 tick 的兜底间隔，与宿主增量刷新同周期（100ms）。 */
export const REVEAL_TICK_MS = 100;
/** 追平系数：放出速率略高于到达速率，积压不会无限增长。 */
const CATCH_UP_RATIO = 1.15;
/** 允许的最大滞后：积压超过这么多毫秒的量时加速追平。 */
const MAX_LAG_MS = 1200;
/** 积压超过这么多字符（切回正在流式的会话）直接对齐，不追。 */
const SNAP_BACKLOG_CHARS = 1500;
/** 没有速率样本时的默认放出速率（字符/毫秒）：约 60 字/秒。 */
export const DEFAULT_RATE_PER_MS = 0.06;
/** 速率下限，慢速流也保持可见的推进。 */
const MIN_RATE_PER_MS = 0.02;
/** 未闭合行内语法最多扣这么久 / 这么长，之后当普通文字放出。 */
export const HOLD_MAX_MS = 800;
const HOLD_MAX_CHARS = 240;
/** 无标点长片段的切分上限（UTF-16 code units），供 rehype 分段。 */
const MAX_PHRASE_LENGTH = 48;
/** 按上限切分时，优先在这个长度之后的最后一个空白处断开。 */
const MIN_SOFT_BREAK_LENGTH = 16;

/** 最后一个片放出后，等这么久再撤掉「最新短语略暗」的包裹类。 */
export const STREAMING_SETTLE_MS = 150;
/** 尾部未完成的词超过这么久没有新内容，就不再等，直接放出，避免模型停顿时文字「卡住」。 */
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

function isWordChar(char: string | undefined): boolean {
	return char !== undefined && /[\p{L}\p{N}_]/u.test(char) && !isCjk(char);
}

function isCjk(char: string): boolean {
	const code = char.codePointAt(0) ?? 0;
	return (
		(code >= 0x3040 && code <= 0x30ff) ||
		(code >= 0x3400 && code <= 0x4dbf) ||
		(code >= 0x4e00 && code <= 0x9fff) ||
		(code >= 0xac00 && code <= 0xd7af) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xff00 && code <= 0xffef)
	);
}

/**
 * 把位置对齐到词边界：不在拉丁词 / 数字中间切开，不切开代理对；CJK 逐字即边界。
 * 只向后推进，最多推到文本末尾。
 */
export function snapToTokenBoundary(text: string, index: number): number {
	let end = Math.min(Math.max(index, 0), text.length);
	if (end > 0 && isHighSurrogate(text.charCodeAt(end - 1))) end += 1;
	while (end < text.length && isWordChar(text[end - 1]) && isWordChar(text[end])) end += 1;
	return end;
}

/**
 * Temporarily hold incomplete inline syntax on the current line. This is a
 * presentation heuristic, not a Markdown parser; timeout and final flush preserve source.
 */
export function holdBackUnclosedInline(text: string, end: number): number {
	const lineStart = text.lastIndexOf("\n", end - 1) + 1;
	let hold = end;
	let backtickStart = -1;
	let backtickLength = 0;
	let mathStart = -1;
	let mathLength = 0;
	let mathCloser: string | null = null;
	let strongStart = -1;
	let linkStart = -1;
	let linkTextClosed = false;
	let destinationDepth = 0;
	for (let index = lineStart; index < end; index++) {
		const char = text[index];
		if (char === "\\") {
			const next = text[index + 1];
			if (backtickStart === -1 && !linkTextClosed) {
				if (mathStart !== -1 && next === mathCloser) {
					mathStart = -1;
					mathCloser = null;
				} else if (mathStart === -1 && (next === "(" || next === "[")) {
					mathStart = index;
					mathLength = 0;
					mathCloser = next === "(" ? ")" : "]";
				}
			}
			index += 1;
			continue;
		}
		if (char === "`") {
			let length = 1;
			while (index + length < end && text[index + length] === "`") length++;
			if (backtickStart !== -1) {
				if (length === backtickLength) backtickStart = -1;
			} else if (mathStart === -1) {
				backtickStart = index;
				backtickLength = length;
			}
			index += length - 1;
			continue;
		}
		if (backtickStart !== -1) continue;
		if (char === "$" && !linkTextClosed) {
			let length = 1;
			while (index + length < end && text[index + length] === "$") length++;
			if (mathStart !== -1) {
				if (length === mathLength) mathStart = -1;
			} else {
				mathStart = index;
				mathLength = length;
			}
			index += length - 1;
			continue;
		}
		if (mathStart !== -1) continue;
		if (char === "*" && index + 1 < end && text[index + 1] === "*") {
			strongStart = strongStart === -1 ? index : -1;
			index += 1;
			continue;
		}
		if (linkStart === -1) {
			if (char === "[") linkStart = index;
			continue;
		}
		if (!linkTextClosed) {
			if (char === "]") {
				if (index + 1 === end) continue;
				if (text[index + 1] === "(") {
					linkTextClosed = true;
					destinationDepth = 1;
					index += 1;
				} else {
					// `[…]` 后面不是 `(`：不是链接，从下一个字符重新找。
					linkStart = -1;
				}
			}
			continue;
		}
		if (char === "(") destinationDepth++;
		if (char === ")" && --destinationDepth === 0) {
			linkStart = -1;
			linkTextClosed = false;
		}
	}
	// `[` 后面紧跟着文本末尾时也可能是链接开头；`]` 刚到、`(` 未到的瞬间同样先扣着。
	if (linkStart !== -1 && (linkTextClosed || end - linkStart < HOLD_MAX_CHARS)) {
		const start = text[linkStart - 1] === "!" ? linkStart - 1 : linkStart;
		hold = Math.min(hold, start);
	}
	if (backtickStart !== -1) hold = Math.min(hold, backtickStart);
	if (mathStart !== -1) hold = Math.min(hold, mathStart);
	if (strongStart !== -1) hold = Math.min(hold, strongStart);
	return hold;
}

export interface RevealPlanInput {
	readonly text: string;
	/** 已显示到的位置。 */
	readonly revealed: number;
	/** 文本不会再增长（流已结束）。 */
	readonly final: boolean;
	/** 最近的到达速率（字符/毫秒）。 */
	readonly ratePerMs: number;
	/** 距上次放出经过的毫秒数。 */
	readonly elapsedMs: number;
	/** 尾部停顿太久：未写完的词也放出。 */
	readonly stalled: boolean;
	/** 当前扣留已经持续的毫秒数；超过上限就不再扣。 */
	readonly heldMs: number;
}

export interface RevealStep {
	/** 本次应显示到的位置。 */
	readonly end: number;
	/** 本次因未闭合的行内语法而少放了内容；宿主据此计时，超时后放开。 */
	readonly held: boolean;
}

/** 规划下一次放出；没有可放的内容时返回 null。 */
export function planReveal(input: RevealPlanInput): RevealStep | null {
	const { text, revealed, final, stalled, heldMs } = input;
	const backlog = text.length - revealed;
	if (backlog <= 0) return null;
	// 流已结束：剩下的一次放完。按速率再分几个 tick 只会让结尾拖成慢动作，用户看到的是「卡一下」。
	if (final) return { end: text.length, held: false };

	const rate = Math.max(MIN_RATE_PER_MS, input.ratePerMs);
	const elapsed = Math.max(0, input.elapsedMs);
	let budget: number;
	if (backlog >= SNAP_BACKLOG_CHARS) {
		budget = backlog;
	} else {
		budget = rate * elapsed * CATCH_UP_RATIO;
		const maxLag = rate * MAX_LAG_MS;
		if (backlog > maxLag) budget = Math.max(budget, backlog - maxLag / 2);
	}
	let end = snapToTokenBoundary(text, revealed + Math.max(1, Math.ceil(budget)));

	// 尾部未写完的词先不显示：等它写完，或停顿太久。
	if (!stalled && end === text.length && isWordChar(text[end - 1])) {
		let back = end;
		while (back > revealed && isWordChar(text[back - 1])) back -= 1;
		end = back;
	}

	let held = false;
	if (heldMs < HOLD_MAX_MS) {
		const safe = holdBackUnclosedInline(text, end);
		if (safe < end && end - safe < HOLD_MAX_CHARS) {
			// The closing delimiter may already have arrived beyond this tick's character
			// budget. Reveal the complete inline construct instead of timing out into raw markup.
			const lookahead = text.slice(safe, safe + HOLD_MAX_CHARS).split("\n", 1)[0] ?? "";
			for (let candidate = end - safe + 1; candidate <= lookahead.length; candidate++) {
				if (holdBackUnclosedInline(lookahead, candidate) === candidate) {
					return { end: safe + candidate, held: false };
				}
			}
			end = Math.max(safe, revealed);
			held = true;
		}
	}
	if (end <= revealed) return held ? { end: revealed, held: true } : null;
	return { end, held };
}
