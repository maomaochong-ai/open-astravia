import type { DbColumnInfo, DbTableScope } from "../../../../preload/api-types/database";

/**
 * DatabaseAiAnchor —— 数据库工作台「问数」的锚点级上下文描述（ADR 决策项 1 的渲染层建模）。
 *
 * 锚点回答「AI 当前应该看哪一块数据库上下文」：
 * - `table` 来源（P0 已落地）：正在打开表浏览 tab 的表，注入该表结构（列结构优先于整连接摘要）；
 * - editor / history / result 来源（P1+ 扩展）：正在编辑的一段 SQL / 历史条目 / 结果集 SQL。
 * 判别联合保证各来源只携带自己需要的字段，杜绝「表锚点无表名」类非法状态。
 */
export type DatabaseAiAnchor =
	| {
			source: "table";
			connectionName: string;
			table: string;
			/** catalog 分层作用域（PG schema / MySQL database）；flat 连接为 null。 */
			scope?: DbTableScope | null;
	  }
	| {
			source: "editor" | "history" | "result";
			connectionName: string;
			sqlText: string;
	  };

/** 表锚点类型：供描述表结构时窄化使用。 */
export type TableAnchor = Extract<DatabaseAiAnchor, { source: "table" }>;

/** scope 限定符：「库名.表名」或「schema.表名」；无 scope 返回裸表名。 */
function qualifiedTableName(table: string, scope: DbTableScope | null | undefined): string {
	const qualifier = scope?.schema ?? scope?.database;
	return qualifier ? `${qualifier}.${table}` : table;
}

/**
 * 把表结构列格式化为注入 instruction 的文本（与主进程 formatTableSchema 列风格一致）。
 * 供「打开的表」锚点使用；P1+ 的编辑器/历史锚点注入可复用本格式化保证视觉一致。
 */
export function formatAnchorTableSchema(anchor: TableAnchor, columns: DbColumnInfo[]): string {
	const lines = columns.map((column) => {
		const parts = [column.name, column.type || "unknown"];
		if (column.isPrimaryKey) parts.push("PRIMARY KEY");
		if (!column.nullable) parts.push("NOT NULL");
		if (column.hasDefault && column.defaultValue) parts.push(`DEFAULT ${column.defaultValue}`);
		if (column.comment) parts.push(`-- ${column.comment}`);
		return `  ${parts.join(" ")}`;
	});
	return `${qualifiedTableName(anchor.table, anchor.scope)} (\n${lines.join("\n")}\n)`;
}
