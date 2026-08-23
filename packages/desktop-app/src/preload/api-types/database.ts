/**
 * 数据库能力抽象层的公共类型。
 *
 * 定义在 preload/api-types 下，main（IPC 实现）、preload（透传）、
 * renderer（抽象层消费）三方共用同一套类型，保证跨进程契约一致。
 */

/** 连接环境标记（W4-②）：生产连接默认禁止写操作。 */
export type ConnectionEnv = "prod" | "dev";

/** 数据库连接（来自 dbx_list_connections）。 */
export interface DbConnection {
	id: string;
	name: string;
	groupPath: string;
	type: string;
	host: string;
	port: number;
	database: string;
	/** 环境标记（W4-②，Astravia 产品层维护，缺省 dev）。 */
	env: ConnectionEnv;
}

/** 数据表信息（来自 dbx_list_tables）。 */
export interface DbTableInfo {
	name: string;
	kind: string;
}

/** 数据列信息（来自 dbx_describe_table）。 */
export interface DbColumnInfo {
	name: string;
	type: string;
	nullable: boolean;
	hasDefault: boolean;
	defaultValue: string;
	comment: string;
	isPrimaryKey: boolean;
}

/** 查询结果（来自 dbx_execute_query 的 Markdown 表格解析）。 */
export interface DbQueryResult {
	columns: string[];
	rows: Array<Record<string, string>>;
	rowCount: number;
	/** 执行耗时，如 "1ms"（dbx 原样返回，可能为空）。 */
	durationMs: string;
	/** 原始 Markdown 文本，供需要原文的场景使用。 */
	rawText: string;
	/** 结果行数被产品层 rowLimit 截断（B3.1-②-A），UI 据此提示。 */
	truncated?: boolean;
}

/** 数据库操作的稳定错误码（对 dbx 原始错误归类后的产物）。 */
export type DatabaseErrorCode =
	| "SQL_BLOCKED"
	| "READ_ONLY"
	| "PROD_WRITE_BLOCKED"
	| "WRITE_BLOCKED"
	| "DDL_BLOCKED"
	| "TIMEOUT"
	| "CONNECTION_NOT_FOUND"
	| "CONNECTION_FAILED"
	| "CONNECTION_EXISTS"
	| "INVALID_PARAMS"
	| "DBX_NOT_RUNNING"
	| "UNKNOWN";

/**
 * 数据库操作的稳定错误。UI / AI 集成只依赖 code 判断分支，
 * detail 是未翻译的原始信息（仅排查用，不直接展示给用户）。
 */
export interface DatabaseError {
	code: DatabaseErrorCode;
	/** 未翻译的原始错误信息（dbx 原文），仅供排查。 */
	detail: string;
}

/**
 * 跨 IPC 的结构化返回。Electron 传输会丢失自定义 Error 字段，
 * 所以错误不靠 throw 跨进程，统一用该结构无损传递。
 */
export type DatabaseResult<T> = { ok: true; data: T } | { ok: false; error: DatabaseError };

/** 新增连接的参数（来自 dbx_add_connection，去掉底层字段名差异）。 */
export interface DbAddConnectionParams {
	name: string;
	dbType: string;
	host: string;
	port?: number;
	username?: string;
	password?: string;
	database?: string;
	ssl?: boolean;
	/** 环境标记（W4-②）；缺省 dev。 */
	env?: ConnectionEnv;
}

/** 连接测试输入：已保存连接按名称测试，未保存的表单按草稿参数测试。 */
export interface DbTestConnectionParams {
	connectionName?: string;
	draft?: DbAddConnectionParams;
}

/** 连接测试结果（成功时返回）。 */
export interface DbConnectionTestResult {
	/** 可读取的表数量（空库为 0，代表连接本身成功）。 */
	tableCount: number;
	/** 引擎返回的原始文本（排查用）。 */
	detail: string;
}

/**
 * preload 暴露给 renderer 的数据库能力接口。
 *
 * 这是 renderer 抽象层（domains/database）与 main 之间的契约；
 * dbx 工具名 / Markdown 细节不跨越此接口。
 */
export interface DesktopDatabaseApi {
	/** 列出全部连接。 */
	listConnections(): Promise<DatabaseResult<DbConnection[]>>;
	/** 新增连接。 */
	addConnection(params: DbAddConnectionParams): Promise<DatabaseResult<{ id: string; name: string }>>;
	/** 测试连接：已保存连接或未保存的表单草稿。 */
	testConnection(params: DbTestConnectionParams): Promise<DatabaseResult<DbConnectionTestResult>>;
	/** 删除连接。 */
	removeConnection(id: string): Promise<DatabaseResult<void>>;
	/** 列出连接下全部表。 */
	listTables(connectionName: string): Promise<DatabaseResult<DbTableInfo[]>>;
	/** 查看表结构。 */
	describeTable(connectionName: string, table: string): Promise<DatabaseResult<DbColumnInfo[]>>;
	/** 执行查询（SELECT），返回结构化结果。 */
	executeQuery(connectionName: string, sql: string): Promise<DatabaseResult<DbQueryResult>>;
	/** 获取连接 schema 上下文（供 AI 注入使用）。 */
	getSchemaContext(connectionName: string): Promise<DatabaseResult<string>>;
}
