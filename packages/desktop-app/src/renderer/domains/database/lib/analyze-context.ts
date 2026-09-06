/**
 * P3:「AI 分析」注入上下文的 token 预算守卫。
 *
 * 主进程 schema-context-injection 对「会话自动注入」的 schema 摘要按 6KB/连接截断；
 * analyze 系列入口（编辑器/历史/结果解读）走 renderer 端 getSchemaContext/summarizeQueryResult，
 * 注入前同样需要预算上限——SQL 主料与 schema/摘要上下文分开设限，防止单条巨型输入打爆对话上下文。
 * 截断判定为纯函数，便于单测。
 */

/** SQL 主料字符上限（注入 instruction 的 {{sql}} 占位）。 */
export const ANALYZE_SQL_CHAR_LIMIT = 8_000;

/** 上下文（schema 摘要 / 结果摘要）字符上限，与主进程 6KB schema 截断口径一致。 */
export const ANALYZE_CONTEXT_CHAR_LIMIT = 6_000;

export interface ClippedText {
	text: string;
	truncated: boolean;
}

/** 超长截断；返回截断后文本与是否发生截断。 */
export function clipToLimit(text: string, limit: number): ClippedText {
	if (text.length <= limit) {
		return { text, truncated: false };
	}
	return { text: text.slice(0, limit), truncated: true };
}
