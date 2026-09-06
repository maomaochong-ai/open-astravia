import type { DbCatalogFamily } from "../../preload/api-types/database.js";

/**
 * catalog 中间层枚举（P2 #8/#9：连接 → database/schema → 表）。
 *
 * 引擎没有独立的 list_databases / list_schemas 工具，中间层作用域名
 * 通过只读的 information_schema 查询枚举（MySQL 的 SCHEMATA 同样返回库名）。
 * 纯函数集中于此：SQL 生成 + 系统对象过滤 + 排序，便于单测。
 */

/** information_schema.schemata 上按 family 取作用域名的只读 SQL（产品层再做系统对象过滤）。 */
export function catalogIntrospectionSql(family: DbCatalogFamily): string | null {
	// flat（SQLite / 单库）没有中间层，返回 null 表示无需枚举。
	if (family === "flat") return null;
	return "SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name";
}

/** 系统级 schema / database，不展示在连接树中（避免噪声，对齐 dbx 默认隐藏系统对象）。 */
const SCHEMA_SYSTEM = new Set(["information_schema", "pg_catalog", "pg_toast"]);
const DATABASE_SYSTEM = new Set(["information_schema", "performance_schema", "mysql", "sys"]);

/**
 * 过滤并排序作用域名：
 * - schemas：去掉系统 schema，public 置顶，其余按字母序；
 * - databases：去掉系统库，按字母序（连接默认库无额外优先级信息）。
 */
export function filterCatalogNames(family: DbCatalogFamily, names: readonly string[]): string[] {
	const system = family === "schemas" ? SCHEMA_SYSTEM : DATABASE_SYSTEM;
	const kept = names.filter((n) => !system.has(n) && !(family === "schemas" && n.startsWith("pg_")));
	kept.sort((a, b) => a.localeCompare(b));
	if (family === "schemas") {
		const idx = kept.indexOf("public");
		if (idx > 0) {
			const [first] = kept.splice(idx, 1);
			kept.unshift(first);
		}
	}
	return kept;
}

/**
 * 从引擎返回的 Markdown 行中提取作用域名：
 * 引擎列名可能是 schema_name / name；取第一列兜底。
 */
export function extractCatalogNames(columns: readonly string[], rows: ReadonlyArray<Record<string, string>>): string[] {
	const col = columns.includes("schema_name") ? "schema_name" : columns[0];
	if (!col) return [];
	const names: string[] = [];
	for (const row of rows) {
		const v = row[col]?.trim();
		if (v) names.push(v);
	}
	return names;
}
