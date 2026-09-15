/**
 * 流式文本的「打字机 + 逐词淡入」节奏。
 *
 * 宿主送来的 delta 是一阵一阵的；直接上屏或攒批上屏都会让整段文字成块地跳出来。
 * 这里把「已显示长度」按帧追赶「目标长度」：积压越多追得越快，积压很少时保持最低速度，
 * 这样既不会远远落后于模型输出，也不会一次倒出一大段。
 */

/** 积压很少时的最低揭示速度，保证尾巴能稳定写完。 */
const MIN_CHARS_PER_SECOND = 45;
/** 任意积压都大约在这段时间内被追平（按帧指数收敛）。 */
const CATCH_UP_MS = 350;
/** 每帧重解析 Markdown 的最小间隔；~30fps 足够顺滑，也给长消息留出主线程余量。 */
export const STREAMING_FRAME_INTERVAL_MS = 32;
/** 与 `.streaming-chunk` 的 CSS 淡入时长一致：追平后等最后一批淡完再撤掉分段 span。 */
export const STREAMING_SETTLE_MS = 280;

/** 返回下一帧应显示到的位置（不会切开 UTF-16 代理对）。 */
export function nextRevealEnd(text: string, revealed: number, elapsedMs: number): number {
	const backlog = text.length - revealed;
	if (backlog <= 0) return text.length;
	const rate = Math.max(MIN_CHARS_PER_SECOND, (backlog * 1000) / CATCH_UP_MS);
	const step = Math.max(1, Math.round((rate * Math.max(0, elapsedMs)) / 1000));
	return snapToCodePoint(text, Math.min(text.length, revealed + step));
}

function snapToCodePoint(text: string, end: number): number {
	if (end <= 0 || end >= text.length) return end;
	const previous = text.charCodeAt(end - 1);
	const next = text.charCodeAt(end);
	return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? end + 1 : end;
}

let wordSegmenter: Intl.Segmenter | null | undefined;

function getWordSegmenter(): Intl.Segmenter | null {
	if (wordSegmenter === undefined) {
		try {
			wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
		} catch {
			wordSegmenter = null;
		}
	}
	return wordSegmenter;
}

/**
 * 把一段文本切成可逐个淡入的片段：英文按词、中文按词组、标点与空白各自独立。
 * 拼接结果恒等于输入。
 */
export function splitStreamingSegments(value: string): string[] {
	const segmenter = getWordSegmenter();
	if (segmenter) return Array.from(segmenter.segment(value), (part) => part.segment);
	return value.split(/(\s+)/).filter(Boolean);
}
