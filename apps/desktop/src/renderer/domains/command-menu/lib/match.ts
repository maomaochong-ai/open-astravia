import type { CommandMenuHighlightRange } from "@vetta/theme-ui/overlays";
import { findSearchTextRanges, normalizeSearchText } from "@/shared/session-search-text";

/**
 * 本地源的匹配层。
 *
 * 语义刻意与主进程的会话检索保持一致——**子串**匹配，不做模糊子序列：
 *  - 会话那边是 `normalizedText.includes(query)`，改不动（后端零改动）；本地源若
 *    引入模糊匹配，同一个面板里就会一半能模糊命中一半不能，"搜不到"变得可疑。
 *  - 子序列匹配在 CJK 下噪音极大：中文没有词边界，"设置" 会命中 "设计与配置"。
 *
 * 唯一的增强是多 token：查询按空白切开后要求**全部命中**，不要求连续或有序，
 * 这样 "设置 语言" 能找到「外观 → 语言」，不必背下完整标题。
 */

export interface CommandMenuMatch {
	/** 越大越靠前。 */
	readonly score: number;
	readonly titleHighlights: readonly CommandMenuHighlightRange[];
	readonly subtitleHighlights: readonly CommandMenuHighlightRange[];
}

/** 词首的分隔符集合；CJK 无词边界，靠前缀命中拿高分即可。 */
const WORD_BOUNDARY = /[\s\-_/.:@[\]()]/;

const SCORE_PREFIX = 3;
const SCORE_WORD_START = 2;
const SCORE_ANYWHERE = 1;
/** 只在副标题命中：能找到，但明显不如标题命中相关。 */
const SCORE_SUBTITLE = 0.5;

/** 把查询切成归一化后的 token；空查询得到空数组（调用方据此走"不过滤"分支）。 */
export function tokenizeCommandMenuQuery(query: string): string[] {
	const normalized = normalizeSearchText(query);
	return normalized ? normalized.split(" ").filter(Boolean) : [];
}

/**
 * 合并区间：入参按 start 升序，重叠或首尾相接的合并成一段。
 * 多 token 各自命中同一段文本时会产生重叠区间，直接渲染会套出嵌套的高亮节点。
 */
export function mergeHighlightRanges(ranges: readonly CommandMenuHighlightRange[]): CommandMenuHighlightRange[] {
	if (ranges.length <= 1) return [...ranges];
	const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
	const merged: CommandMenuHighlightRange[] = [];
	for (const range of sorted) {
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end) {
			if (range.end > previous.end) merged[merged.length - 1] = { start: previous.start, end: range.end };
			continue;
		}
		merged.push({ ...range });
	}
	return merged;
}

function positionScore(text: string, start: number): number {
	if (start === 0) return SCORE_PREFIX;
	const previous = text[start - 1];
	return previous && WORD_BOUNDARY.test(previous) ? SCORE_WORD_START : SCORE_ANYWHERE;
}

/**
 * 每个 token 必须在标题或副标题里命中（AND 语义）；任一 token 落空即整条不匹配。
 * 空 token 列表视为"全部通过"，分数为 0——空查询下由调用方的默认次序决定排列。
 */
export function matchCommandMenuEntry(
	entry: { readonly title: string; readonly subtitle?: string },
	tokens: readonly string[],
): CommandMenuMatch | null {
	if (tokens.length === 0) {
		return { score: 0, titleHighlights: [], subtitleHighlights: [] };
	}

	const titleRanges: CommandMenuHighlightRange[] = [];
	const subtitleRanges: CommandMenuHighlightRange[] = [];
	let score = 0;

	for (const token of tokens) {
		const inTitle = findSearchTextRanges(entry.title, token);
		if (inTitle.length > 0) {
			titleRanges.push(...inTitle);
			score += positionScore(entry.title, inTitle[0].start);
			continue;
		}
		const inSubtitle = entry.subtitle ? findSearchTextRanges(entry.subtitle, token) : [];
		if (inSubtitle.length > 0) {
			subtitleRanges.push(...inSubtitle);
			score += SCORE_SUBTITLE;
			continue;
		}
		return null;
	}

	return {
		score,
		titleHighlights: mergeHighlightRanges(titleRanges),
		subtitleHighlights: mergeHighlightRanges(subtitleRanges),
	};
}
