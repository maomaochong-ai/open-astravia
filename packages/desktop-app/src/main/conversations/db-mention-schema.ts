import type { DbColumnInfo } from "../../preload/api-types/database.js";

// 反循环指令常量（与 schema-context-injection.ts 保持一致，两处各自引用同一 prompt 文本但
// 因为该指令是纯字符串且两处版本略有不同——system prompt 版更长——所以各自定义避免 import chain 拉 Electron）。
/** Per-message @mention 注入的精简版反循环指令（不重复完整纪律，只说核心）。 */
export const DB_AI_PER_MESSAGE_ANTI_LOOP =
	"⚠️ **工具纪律（重要）**：上方已提供这些表的完整 schema，" +
	"**不要再调 dbx_describe_table / dbx_get_schema_context / dbx_list_tables 拉 schema**。" +
	"只用 dbx_execute_query 跑 SELECT 查询。";

/**
 * 从 PromptRequest metadata 里安全提取 databaseMentions 数组。
 *
 * Astravia 前端 → main 的 per-message @mention 数据契约：
 * - metadata 结构松散（JSON 透传），这里做强类型守卫
 * - 必须有 connection + table；scope 可选
 * - scope 字符串不能是空串
 */
export interface DbMentionRef {
	connection: string;
	table: string;
	scope?: string;
}

/** 从 metadata 安全提取 databaseMentions；缺字段 / 空值 / 非数组都返回空数组。 */
export function extractDbMentions(metadata: unknown): DbMentionRef[] {
	if (!metadata || typeof metadata !== "object") return [];
	const md = metadata as Record<string, unknown>;
	const raw = md.databaseMentions;
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((m): m is DbMentionRef => {
			if (!m || typeof m !== "object") return false;
			const obj = m as Record<string, unknown>;
			if (typeof obj.connection !== "string" || !obj.connection.trim()) return false;
			if (typeof obj.table !== "string" || !obj.table.trim()) return false;
			if (obj.scope !== undefined && typeof obj.scope !== "string") return false;
			return true;
		})
		.map((m) => {
			const scope = m.scope?.trim();
			return {
				connection: m.connection.trim(),
				table: m.table.trim(),
				...(scope ? { scope } : {}),
			};
		});
}

/**
 * 把 describeTable 返回的列列表格式化成 AI 可读的 schema 文本块。
 *
 * （此版本与 desktop-conversation-service.ts 被删除的本地函数行为一致）
 * 格式：
 * ```
 * 数据库表 @conn[.scope].table（scope: xxx）的结构如下：
 * - col_name: TYPE [PRIMARY KEY] [NULLABLE] [DEFAULT val] [-- comment]
 * ```
 */
export function formatMentionedTableSchema(
	connection: string,
	table: string,
	columns: DbColumnInfo[],
	scope?: string,
): string {
	const scopeHint = scope ? `（scope: ${scope}）` : "";
	const lines: string[] = [`数据库表 @${connection}${scope ? `.${scope}` : ""}.${table}${scopeHint} 的结构如下：`];
	for (const col of columns) {
		const parts: string[] = [`- ${col.name}: ${col.type}`];
		if (col.isPrimaryKey) parts.push("PRIMARY KEY");
		if (col.nullable) parts.push("NULLABLE");
		if (col.hasDefault) parts.push(`DEFAULT ${col.defaultValue}`);
		if (col.comment) parts.push(`-- ${col.comment}`);
		lines.push(parts.join(" "));
	}
	return lines.join("\n");
}

/** per-message @mention schema 注入的完整拼装（schemaBlocks → 追加反循环指令） */
export function composeMentionedSchemaPromptSuffix(schemaBlocks: string[]): string {
	return [...schemaBlocks, DB_AI_PER_MESSAGE_ANTI_LOOP].join("\n\n");
}
