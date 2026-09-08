import type { DbCatalogFamily, DbTableObjectKind, DbTableScope } from "../../preload/api-types/database.js";

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

/** SQL 字符串字面量转义（PG/MySQL/SQLite 通用：单引号翻倍）。 */
export function escapeSqlLiteral(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

/**
 * 表级子对象枚举 SQL（树深：索引/约束/触发器/分区）。
 *
 * 引擎没有专门的子对象工具，沿用 catalog 中间层同款思路：以只读
 * information_schema / 系统表查询枚举（不新增引擎工具面）。
 * 返回 null = 该 family/kind 组合不支持或缺少必要 scope（不做枚举）。
 */
export function tableObjectIntrospectionSql(
	family: DbCatalogFamily,
	kind: DbTableObjectKind,
	table: string,
	scope?: DbTableScope | null,
): string | null {
	const t = escapeSqlLiteral(table);

	// schemas ≈ PostgreSQL 系：需 schema 限定；分区经 pg_inherits 取子表。
	if (family === "schemas") {
		const schema = scope?.schema;
		if (!schema) return null;
		const s = escapeSqlLiteral(schema);
		switch (kind) {
			case "index":
				return `SELECT indexname AS name FROM pg_indexes WHERE schemaname = ${s} AND tablename = ${t} ORDER BY indexname`;
			case "constraint":
				// 主题 E：FK 独立为 "foreign-key" 组，约束组只留 PK/唯一/检查。
				return `SELECT constraint_name AS name FROM information_schema.table_constraints WHERE table_schema = ${s} AND table_name = ${t} AND constraint_type <> 'FOREIGN KEY' ORDER BY constraint_name`;
			case "foreign-key":
				return `SELECT constraint_name AS name FROM information_schema.table_constraints WHERE table_schema = ${s} AND table_name = ${t} AND constraint_type = 'FOREIGN KEY' ORDER BY constraint_name`;
			case "trigger":
				return `SELECT trigger_name AS name FROM information_schema.triggers WHERE event_object_schema = ${s} AND event_object_table = ${t} ORDER BY trigger_name`;
			case "partition":
				return `SELECT child.relname AS name FROM pg_inherits i JOIN pg_class child ON child.oid = i.inhrelid JOIN pg_class parent ON parent.oid = i.inhparent JOIN pg_namespace ns ON ns.oid = parent.relnamespace WHERE ns.nspname = ${s} AND parent.relname = ${t} ORDER BY child.relname`;
		}
		return null;
	}

	// databases ≈ MySQL 系：需 database 限定。
	if (family === "databases") {
		const db = scope?.database;
		if (!db) return null;
		const d = escapeSqlLiteral(db);
		switch (kind) {
			case "index":
				return `SELECT DISTINCT index_name AS name FROM information_schema.statistics WHERE table_schema = ${d} AND table_name = ${t} ORDER BY index_name`;
			case "constraint":
				// 主题 E：FK 独立为 "foreign-key" 组，约束组只留 PK/唯一/检查。
				return `SELECT constraint_name AS name FROM information_schema.table_constraints WHERE table_schema = ${d} AND table_name = ${t} AND constraint_type <> 'FOREIGN KEY' ORDER BY constraint_name`;
			case "foreign-key":
				return `SELECT DISTINCT constraint_name AS name FROM information_schema.table_constraints WHERE table_schema = ${d} AND table_name = ${t} AND constraint_type = 'FOREIGN KEY' ORDER BY constraint_name`;
			case "trigger":
				return `SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = ${d} AND event_object_table = ${t} ORDER BY trigger_name`;
			case "partition":
				return `SELECT partition_name AS name FROM information_schema.partitions WHERE table_schema = ${d} AND table_name = ${t} AND partition_name IS NOT NULL ORDER BY partition_name`;
		}
		return null;
	}

	// flat（SQLite/DuckDB/其它单库）：引擎间系统表差异大，本轮不枚举，返回 null。
	return null;
}

/** 从引擎返回的 Markdown 行中提取子对象名（统一列名 name，第一列兜底）。 */
export function extractTableObjectNames(
	columns: readonly string[],
	rows: ReadonlyArray<Record<string, string>>,
): string[] {
	const col = columns.includes("name") ? "name" : columns[0];
	if (!col) return [];
	const names: string[] = [];
	for (const row of rows) {
		const v = row[col]?.trim();
		if (v) names.push(v);
	}
	return names;
}
