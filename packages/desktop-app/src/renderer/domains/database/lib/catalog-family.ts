/**
 * 数据库 catalog 层级辅助函数。
 *
 * catalogFamilyOfType / scopeToTableScope 已抽到 preload/api-types/database.ts，
 * renderer 侧本文件 re-export 以便模块内现有引用路径不变。
 */
export { catalogFamilyOfType, scopeToTableScope } from "../../../../preload/api-types/database";

import type { DbCatalogScope, DbTableScope } from "../../../../preload/api-types/database";

/** catalog 作用域是否有效（供 UI 兜底：空名 / 系统内部不可用名直接跳过）。 */
export function isUsableScope(scope: DbCatalogScope): boolean {
	return scope.name.trim().length > 0;
}

/** DbTableScope → 生成限定 SQL 名的 qualifier 段（schema 优先，database 兜底；无 scope = 不限定）。 */
export function tableScopeQualifier(scope: DbTableScope | null | undefined): string | undefined {
	if (!scope) return undefined;
	return scope.schema ?? scope.database;
}
