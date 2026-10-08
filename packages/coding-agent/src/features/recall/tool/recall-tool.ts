import type { RuntimeToolDefinition } from "@astravia/runtime-core/kernel";
import { type Static, Type } from "@sinclair/typebox";

/**
 * recall 工具：把被压缩的历史读回给模型。
 *
 * 背景（ADR 语义对齐 PI-Desktop #721 的可逆压缩边界）：AS 的会话文档在压缩后
 * 完整保留原始条目（conversation-compaction-projection: "persisted branch keeps
 * the original entries"），但模型可见视图只剩「摘要 + 保留尾」——摘要没写到的
 * 细节对模型即失明，这是压缩「断档」的本质。缺的不是数据，是一条读回通路。
 *
 * 数据源经闭包注入（readEntries）：工具执行上下文的 messages 是模型可见视图
 * （不含被压缩原文），不能作为搜索底。宿主（desktop composition）装配时把
 * 会话文档读取函数喂进来；未装配则本工具不注册，模型界面零变化。
 *
 * 搜索语义（与 PI #721 ADR 0300 一致，刻意保持词法）：
 * - query 分词后按 AND 匹配：每个词都要出现（大小写不敏感；CJK 按字面）；
 * - 排序：命中词数 × 频次；
 * - 分页：offset + limit 逐条返回，每条带 entryId 与角色；
 * - 空结果返回「该试什么」而非沉默。
 */

export interface RecallEntry {
	readonly entryId: string;
	/** 消息角色（user/assistant/toolResult/...），仅供模型判断来源。 */
	readonly role: string;
	/** 可搜索的正文（宿主投影：文本块拼接；含工具输出）。 */
	readonly text: string;
}

export interface RecallToolOptions {
	/** 会话历史读取（宿主注入；含被压缩的原始条目）。 */
	readonly readEntries: (sessionId: string) => Promise<readonly RecallEntry[]> | readonly RecallEntry[];
	/** 测试注入固定时间。 */
	readonly now?: () => number;
}

export const RecallToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	query: Type.String({
		description:
			"Search terms for the session's full history (including compacted-away messages). Every term must appear in a message (AND). Case-insensitive; CJK matches literally. Word splitting is on whitespace.",
	}),
	offset: Type.Optional(Type.Number({ description: "Skip the first N matches (default 0)", minimum: 0 })),
	limit: Type.Optional(
		Type.Number({ description: "Max messages to return (default 10, max 30)", minimum: 1, maximum: 30 }),
	),
});

export type RecallToolInput = Static<typeof RecallToolInputSchema>;

export const RECALL_TOOL_DESCRIPTION = `Search this session's COMPLETE history — including messages that were compacted away by context compression — and read them back verbatim.

When to use: after a context compaction, details that the summary did not mention (a file's exact content, a command's output, an earlier decision) are no longer in your visible context, but they still exist on disk. Use this tool to fetch them back instead of guessing or re-running work.

Matching rules:
- Terms are split on whitespace; EVERY term must appear in a message (AND matching).
- Case-insensitive; CJK characters match literally (no stemming, no paraphrase).
- Results are ranked by how many terms matched and how often; each result carries the entryId and role.
- Use offset/limit to page through matches.

If a query returns nothing: try fewer or more distinctive terms, an exact identifier from the summary (file paths, function names, commands), or check spelling. This is a literal search — paraphrases of the original wording will not match.`;

interface ScoredEntry {
	readonly entry: RecallEntry;
	readonly matchedTerms: number;
	readonly totalHits: number;
}

function tokenize(query: string): string[] {
	return [
		...new Set(
			query
				.toLowerCase()
				.split(/\s+/)
				.map((term) => term.trim())
				.filter((term) => term.length > 0),
		),
	];
}

export function rankRecallEntries(entries: readonly RecallEntry[], query: string): readonly ScoredEntry[] {
	const terms = tokenize(query);
	if (terms.length === 0) return [];
	const scored: ScoredEntry[] = [];
	for (const entry of entries) {
		if (entry.text.length === 0) continue;
		const haystack = entry.text.toLowerCase();
		let matchedTerms = 0;
		let totalHits = 0;
		let missing = false;
		for (const term of terms) {
			const hits = countOccurrences(haystack, term);
			if (hits === 0) {
				missing = true;
				break;
			}
			matchedTerms += 1;
			totalHits += hits;
		}
		if (!missing) scored.push({ entry, matchedTerms, totalHits });
	}
	// 全部词都命中（AND）才有资格；按 (词数, 频次) 降序，稳定排序保原文顺序。
	return scored.sort((a, b) => b.matchedTerms - a.matchedTerms || b.totalHits - a.totalHits);
}

function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

const DEFAULT_LIMIT = 10;
const MAX_SNIPPET_CHARS = 1500;

function formatEntry(scored: ScoredEntry): string {
	const { entry } = scored;
	const snippet =
		entry.text.length > MAX_SNIPPET_CHARS
			? `${entry.text.slice(0, MAX_SNIPPET_CHARS)}\n[…truncated ${entry.text.length - MAX_SNIPPET_CHARS} chars — narrow the query or read via a more specific term]`
			: entry.text;
	return `--- entryId=${entry.entryId} role=${entry.role} (matched ${scored.matchedTerms} term(s), ${scored.totalHits} hit(s))\n${snippet}`;
}

export function createRecallTool(options: RecallToolOptions): RuntimeToolDefinition<RecallToolInput> {
	return {
		name: "recall",
		label: "Recall",
		description: RECALL_TOOL_DESCRIPTION,
		inputSchema: RecallToolInputSchema,
		async execute({ input, sessionId }) {
			const offset = Math.max(0, Math.floor(input.offset ?? 0));
			const limit = Math.max(1, Math.min(30, Math.floor(input.limit ?? DEFAULT_LIMIT)));
			const entries = await options.readEntries(sessionId);
			const ranked = rankRecallEntries(entries, input.query);
			if (ranked.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: "No message in this session's full history matches every term. Try: fewer terms; an exact identifier from the summary (file path, function name, command); or check spelling — this is a literal AND search, paraphrases do not match.",
						},
					],
					details: { totalMatches: 0 },
				};
			}
			const page = ranked.slice(offset, offset + limit);
			const header = `${ranked.length} message(s) in the full history match; showing ${page.length} (offset ${offset}, limit ${limit}).`;
			const body = page.map(formatEntry).join("\n\n");
			const footer =
				offset + page.length < ranked.length
					? `\n\n[${ranked.length - offset - page.length} more match(es) — pass a larger offset to page]`
					: "";
			return {
				content: [{ type: "text", text: `${header}\n\n${body}${footer}` }],
				details: { totalMatches: ranked.length, returned: page.length, offset },
			};
		},
	};
}
