import type {
	DatabaseError,
	DbAddConnectionParams,
	DbCatalogFamily,
	DbCatalogScope,
	DbColumnInfo,
	DbConnection,
	DbConnectionTestResult,
	DbExecuteQueryOptions,
	DbQueryResult,
	DbTableInfo,
	DbTableObjectKind,
	DbTableScope,
	DbTestConnectionParams,
} from "../../../../preload/api-types/database.js";

/**
 * 数据库能力抽象层（renderer 领域核心，B2.1）。
 *
 * 这是 UI / AI 集成唯一依赖的稳定接口：所有数据库操作都经由
 * window.astravia.database（preload 透传 → main databaseService → dbx-mcp），
 * dbx 工具名 / Markdown 格式被完全隔离在 main 进程内。
 *
 * 本模块只做两件事：
 * 1. 把 window.astravia.database 的 DatabaseResult 解包成「成功值 / 抛错」；
 * 2. 提供稳定的领域类型别名（DbConnection 等），UI 不必 import preload 类型。
 */

/** 稳定领域类型（UI / AI 集成用）。 */
export type {
	DbAddConnectionParams,
	DbCatalogFamily,
	DbCatalogScope,
	DbTableObjectKind,
	DbColumnInfo,
	DbConnection,
	DbConnectionTestResult,
	DatabaseError,
	DbQueryResult,
	DbTableInfo,
	DbTableScope,
	DbTestConnectionParams,
};

/** 解包 DatabaseResult：成功返回 data，失败抛 DatabaseError。 */
export function unwrapDatabaseResult<T>(result: { ok: true; data: T } | { ok: false; error: DatabaseError }): T {
	if (result.ok) return result.data;
	throw result.error;
}

/** 列出全部连接。 */
export async function listConnections(): Promise<DbConnection[]> {
	return unwrapDatabaseResult(await window.astravia.database.listConnections());
}

/** 新增连接。 */
export async function addConnection(params: DbAddConnectionParams): Promise<{ id: string; name: string }> {
	return unwrapDatabaseResult(await window.astravia.database.addConnection(params));
}

/** 测试连接（已保存连接或未保存的表单草稿）。 */
export async function testConnection(params: DbTestConnectionParams): Promise<DbConnectionTestResult> {
	return unwrapDatabaseResult(await window.astravia.database.testConnection(params));
}

/** 删除连接。 */
export async function removeConnection(id: string): Promise<void> {
	unwrapDatabaseResult(await window.astravia.database.removeConnection(id));
}

/** 列出连接下全部表（可选 catalog 作用域：schema / database）。 */
export async function listTables(connectionName: string, scope?: DbTableScope): Promise<DbTableInfo[]> {
	return unwrapDatabaseResult(await window.astravia.database.listTables(connectionName, scope));
}

/** 枚举 catalog 中间层作用域名（schema / database；flat 连接返回空数组）。 */
export async function listCatalogScopes(connectionName: string, family: DbCatalogFamily): Promise<string[]> {
	return unwrapDatabaseResult(await window.astravia.database.listCatalogScopes(connectionName, family));
}
/** 枚举表级子对象名（索引/约束/触发器/分区；flat 或不支持时返回空数组）。 */
export async function listTableObjectNames(
	connectionName: string,
	table: string,
	kind: DbTableObjectKind,
	family: DbCatalogFamily,
	scope?: DbTableScope,
): Promise<string[]> {
	return unwrapDatabaseResult(
		await window.astravia.database.listTableObjectNames(connectionName, table, kind, family, scope),
	);
}

/** 查看表结构（可选 catalog 作用域：schema / database）。 */
export async function describeTable(
	connectionName: string,
	table: string,
	scope?: DbTableScope,
): Promise<DbColumnInfo[]> {
	return unwrapDatabaseResult(await window.astravia.database.describeTable(connectionName, table, scope));
}

/** 执行查询（SELECT / 写语句）。options.confirmedWrite：写/DDL 语句经 UI 危险确认后重发放行。 */
export async function executeQuery(
	connectionName: string,
	sql: string,
	options?: DbExecuteQueryOptions,
): Promise<DbQueryResult> {
	return unwrapDatabaseResult(await window.astravia.database.executeQuery(connectionName, sql, options));
}

/** 获取连接 schema 上下文（供 AI 注入使用）。 */
export async function getSchemaContext(connectionName: string): Promise<string> {
	return unwrapDatabaseResult(await window.astravia.database.getSchemaContext(connectionName));
}
