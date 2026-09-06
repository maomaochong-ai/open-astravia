import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import type {
	DbAddConnectionParams,
	DbCatalogFamily,
	DbExecuteQueryOptions,
	DbTableObjectKind,
	DbTableScope,
	DbTestConnectionParams,
} from "../api-types/database.js";

/**
 * preload 数据库能力 API 实现。
 *
 * 纯透传：renderer 调用 → IPC 通道 → main databaseService。
 * 类型契约见 api-types/database.ts（DatabaseResult 跨进程无损）。
 * 返回 Pick<DesktopApi, "database">，与 abilities 等其他 API 模式一致。
 */

const CHANNELS = {
	LIST_CONNECTIONS: "astravia:database:list-connections",
	ADD_CONNECTION: "astravia:database:add-connection",
	TEST_CONNECTION: "astravia:database:test-connection",
	REMOVE_CONNECTION: "astravia:database:remove-connection",
	LIST_TABLES: "astravia:database:list-tables",
	LIST_CATALOG_SCOPES: "astravia:database:list-catalog-scopes",
	LIST_TABLE_OBJECT_NAMES: "astravia:database:list-table-object-names",
	DESCRIBE_TABLE: "astravia:database:describe-table",
	EXECUTE_QUERY: "astravia:database:execute-query",
	GET_SCHEMA_CONTEXT: "astravia:database:get-schema-context",
} as const;

export function createDatabaseApi(ipcRenderer: IpcRenderer): Pick<DesktopApi, "database"> {
	return {
		database: {
			listConnections: () => ipcRenderer.invoke(CHANNELS.LIST_CONNECTIONS),
			addConnection: (params: DbAddConnectionParams) => ipcRenderer.invoke(CHANNELS.ADD_CONNECTION, params),
			testConnection: (params: DbTestConnectionParams) => ipcRenderer.invoke(CHANNELS.TEST_CONNECTION, params),
			removeConnection: (id: string) => ipcRenderer.invoke(CHANNELS.REMOVE_CONNECTION, id),
			listTables: (connectionName: string, scope?: DbTableScope) =>
				ipcRenderer.invoke(CHANNELS.LIST_TABLES, connectionName, scope),
			listCatalogScopes: (connectionName: string, family: DbCatalogFamily) =>
				ipcRenderer.invoke(CHANNELS.LIST_CATALOG_SCOPES, connectionName, family),
			listTableObjectNames: (
				connectionName: string,
				table: string,
				kind: DbTableObjectKind,
				family: DbCatalogFamily,
				scope?: DbTableScope,
			) => ipcRenderer.invoke(CHANNELS.LIST_TABLE_OBJECT_NAMES, connectionName, table, kind, family, scope),
			describeTable: (connectionName: string, table: string, scope?: DbTableScope) =>
				ipcRenderer.invoke(CHANNELS.DESCRIBE_TABLE, connectionName, table, scope),
			executeQuery: (connectionName: string, sql: string, options?: DbExecuteQueryOptions) =>
				ipcRenderer.invoke(CHANNELS.EXECUTE_QUERY, connectionName, sql, options),
			getSchemaContext: (connectionName: string) => ipcRenderer.invoke(CHANNELS.GET_SCHEMA_CONTEXT, connectionName),
		},
	};
}
