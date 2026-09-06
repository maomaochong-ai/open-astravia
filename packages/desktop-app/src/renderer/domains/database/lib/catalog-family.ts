import type { DbCatalogFamily, DbCatalogScope, DbTableScope } from "../../../../preload/api-types/database";

/**
 * 驱动族 → catalog 组织方式（对齐 dbx 树层级，P2 #8/#9）：
 * - "schemas"   PG 系：连接指向具体库，库内按 schema 分层（连接 → schema → 表 → 列）。
 * - "databases" MySQL 系：同一服务多库，按 database 分层（连接 → database → 表 → 列）。
 * - "flat"      SQLite / DuckDB / 其它单库连接：表平铺在连接下（与改造前一致）。
 *
 * 注意：dbType 是连接表单里的驱动类型标识（如 "postgres" / "mysql" / "sqlite"），
 * 不是驱动 JDBC 类名；未识别类型一律按 flat 处理，避免破坏现有树。
 */
export function catalogFamilyOfType(dbType: string): DbCatalogFamily {
	const t = dbType.toLowerCase();
	if (
		t === "postgres" ||
		t === "postgresql" ||
		t === "pg" ||
		t === "pgsql" ||
		t === "redshift" ||
		t === "cockroachdb" ||
		t === "cockroach" ||
		t === "edb"
	) {
		return "schemas";
	}
	if (
		t === "mysql" ||
		t === "mariadb" ||
		t === "tidb" ||
		t === "doris" ||
		t === "starrocks" ||
		t === "oceanbase-mysql" ||
		t === "mysql2"
	) {
		return "databases";
	}
	return "flat";
}

/** catalog 作用域是否有效（供 UI 兜底：空名 / 系统内部不可用名直接跳过）。 */
export function isUsableScope(scope: DbCatalogScope): boolean {
	return scope.name.trim().length > 0;
}

/** catalog 作用域 → 引擎 list_tables / describe_table 参数（与 explorer model 保持同一映射）。 */
export function scopeToTableScope(scope: DbCatalogScope): DbTableScope {
	return scope.kind === "schema" ? { schema: scope.name } : { database: scope.name };
}

/** DbTableScope → 生成限定 SQL 名的 qualifier 段（schema 优先，database 兜底；无 scope = 不限定）。 */
export function tableScopeQualifier(scope: DbTableScope | null | undefined): string | undefined {
	if (!scope) return undefined;
	return scope.schema ?? scope.database;
}
