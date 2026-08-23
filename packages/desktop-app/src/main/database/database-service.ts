import { randomUUID } from "node:crypto";
import type {
	DatabaseError,
	DatabaseResult,
	DbAddConnectionParams,
	DbColumnInfo,
	DbConnection,
	DbConnectionTestResult,
	DbQueryResult,
	DbTableInfo,
	DbTestConnectionParams,
} from "../../preload/api-types/database.js";
import { readConfigSync, writeDesktopConfig } from "../config/desktop-config-store.js";
import { getAppLogger } from "../logger.js";
import { getDbxMcpClient } from "./dbx-mcp-client.js";
import { isWriteStatement, maybeBlockWrite } from "./sql-safety.js";

/**
 * 数据库能力桥接服务（main 进程）。
 *
 * 这是全仓库唯一知道 dbx 工具名 / Markdown 返回格式的层：
 * - 调用 dbx MCP 工具（dbx_list_connections / dbx_execute_query …）
 * - 把 Markdown 文本解析为结构化数据（DbConnection / DbQueryResult …）
 * - 把 dbx 原始错误归类为稳定的 DatabaseError（SQL_BLOCKED 等）
 *
 * 所有方法返回 DatabaseResult<T>（不 throw），保证错误信息
 * 能无损跨 IPC 传输（Electron 传输会丢失自定义 Error 字段）。
 * 上层（renderer 抽象层 / 未来 AI 集成）只依赖
 * preload/api-types/database.ts 里声明的稳定接口，不感知 dbx。
 */

function ok<T>(data: T): DatabaseResult<T> {
	return { ok: true, data };
}

function err<T>(error: DatabaseError): DatabaseResult<T> {
	return { ok: false, error };
}

/**
 * 写审计日志（尽力而为）：logger 未初始化 / 环境不支持时静默跳过，
 * 绝不因日志失败破坏查询主链路（测试环境无 electron-log）。
 */
function auditWrite(level: "info" | "warn", message: string): void {
	try {
		getAppLogger("database")[level](message);
	} catch {
		// 静默：审计是辅助能力，查询执行不受影响。
	}
}

/** 把 dbx 工具错误文本归类为稳定 DatabaseError。 */
function classifyError(raw: string): DatabaseError {
	if (raw.includes("SQL_BLOCKED")) {
		return { code: "SQL_BLOCKED", detail: raw };
	}
	if (raw.includes("DBX_NOT_RUNNING")) {
		return { code: "DBX_NOT_RUNNING", detail: raw };
	}
	if (/connection.*not.*found|ConnectionNotFound/i.test(raw)) {
		return { code: "CONNECTION_NOT_FOUND", detail: raw };
	}
	if (/MCP_READ_ONLY|read-only mode/i.test(raw)) {
		return { code: "READ_ONLY", detail: raw };
	}
	if (/already exists/i.test(raw)) {
		return { code: "CONNECTION_EXISTS", detail: raw };
	}
	if (/INVALID_CONNECTION_TYPE|Unsupported database type|INVALID_CONNECTION|Port is required/i.test(raw)) {
		return { code: "INVALID_PARAMS", detail: raw };
	}
	if (/timed?\s*out|timeout/i.test(raw)) {
		return { code: "TIMEOUT", detail: raw };
	}
	if (/connection|failed|refused|ECONN|TABLE_LIST_ERROR|CONNECTION_LOAD_ERROR|CONNECTION_SAVE_ERROR/i.test(raw)) {
		return { code: "CONNECTION_FAILED", detail: raw };
	}
	return { code: "UNKNOWN", detail: raw };
}

/** 提取 dbx 工具返回的文本内容。 */
function textOf(result: { content?: Array<{ text?: string }> }): string {
	return result.content?.map((c) => c.text ?? "").join("\n") ?? "";
}

/** 解析 Markdown 表格 → 列名 + 行。 */
function parseMarkdownTable(text: string): { columns: string[]; rows: Array<Record<string, string>> } {
	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.startsWith("|"));
	if (lines.length < 2) return { columns: [], rows: [] };

	const split = (line: string) =>
		line
			.replace(/^\|/, "")
			.replace(/\|$/, "")
			.split("|")
			.map((c) => c.trim());

	const columns = split(lines[0]);
	// 第二行是分隔线（| --- | --- |），跳过
	const rows = lines.slice(2).map((line) => {
		const cells = split(line);
		const row: Record<string, string> = {};
		columns.forEach((col, i) => {
			row[col] = cells[i] ?? "";
		});
		return row;
	});
	return { columns, rows };
}

/** 从行里按候选列名取第一个非空值。 */
function pick(row: Record<string, string>, names: string[]): string {
	for (const n of names) {
		const v = row[n];
		if (v !== undefined && v !== "") return v;
	}
	return "";
}

/** 解析 Markdown 无序列表（`- name (kind)`）。 */
function parseBulletList(text: string): string[] {
	const items: string[] = [];
	for (const line of text.split("\n")) {
		const m = line.trim().match(/^[-*]\s*(.+)$/);
		if (m) items.push(m[1].trim());
	}
	return items;
}

/**
 * 解析 dbx_list_tables 返回的表清单文本 → 表信息列表。
 *
 * 兼容两种实际见过的格式：
 * 1. 无序列表：`- users (BASE TABLE)`；PostgreSQL 会带表注释后缀：`- dwd_xxx (BASE TABLE) -- 物业费`；
 * 2. 个别版本返回 Markdown 表格（列名 Name/Table + Type/Kind）。
 * 纯函数，便于单测。
 */
export function parseTableList(text: string): DbTableInfo[] {
	const tables: DbTableInfo[] = [];
	for (const item of parseBulletList(text)) {
		// 兼容 dbx 附加的 `-- 注释` 后缀（SQL 注释语法，位于类型括号之后；表名本身不含括号配对）
		const m = item.match(/^(.+?)\s*\(([^)]+)\)(?:\s*--.*)?$/);
		if (m) {
			tables.push({ name: m[1].trim(), kind: m[2].trim() });
		} else {
			// 无类型行：仅剥离带空白分隔的注释后缀，避免误伤含 `--` 的表名
			tables.push({ name: item.replace(/\s+--.*$/, "").trim(), kind: "" });
		}
	}
	// 个别版本返回表格，兜底解析（列名候选覆盖常见中英文变体）
	if (tables.length === 0) {
		const { rows } = parseMarkdownTable(text);
		for (const row of rows) {
			const name = pick(row, ["Name", "name", "Table", "table", "Table Name", "表名"]);
			if (name) tables.push({ name, kind: pick(row, ["Type", "type", "Kind", "kind", "Table Type", "类型"]) });
		}
	}
	return tables;
}

/**
/**
 * 解析 dbx_describe_table 返回的行 → 列结构列表。纯函数，便于单测。
 *
 * 主键检测多格式兼容（B3.2 修复，PG/MySQL 未验证过 SQLite 的 `(PK)` 约定）：
 * 1. 列名单元格带 `id (PK)` / `id (PRIMARY KEY)`（SQLite 实测格式）；
 * 2. 独立 Key 列（MySQL `PRI` / `PRIMARY KEY` / `PK`）；
 * 3. Comment 里的 `PRIMARY KEY` / `PK` 标记。
 */
export function parseDescribeColumns(rows: Array<Record<string, string>>): DbColumnInfo[] {
	return rows.map((row) => {
		const nameCell = pick(row, ["Column", "Name", "name"]);
		const keyCell = pick(row, ["Key", "KeyType", "Key type", "keys"]);
		const commentCell = pick(row, ["Comment", "comment"]);
		const isPrimaryKey = isPkMarker([nameCell, keyCell, commentCell]);
		// 清理列名内嵌的主键标记（`id (PK)` → `id`）。
		const name = nameCell.replace(/\s*\((?:PK|PRIMARY KEY)\)\s*/gi, "").trim();
		const defaultCell = pick(row, ["Default", "default"]);
		return {
			name,
			type: pick(row, ["Type", "type"]),
			nullable: (pick(row, ["Nullable", "nullable"]) || "YES").toUpperCase() !== "NO",
			hasDefault: defaultCell.length > 0,
			defaultValue: defaultCell,
			comment: commentCell,
			isPrimaryKey,
		};
	});
}

/** 主键标记检测：任一处出现 (PK) / 独立 PK / PRI / PRIMARY KEY 即视为主键列。 */
function isPkMarker(cells: string[]): boolean {
	const hay = cells.join(" ").toUpperCase();
	return hay.includes("(PK)") || /\bPK\b/.test(hay) || /\bPRI\b/.test(hay) || /\bPRIMARY KEY\b/.test(hay);
}

/**
 * 连接列表去重（纯函数，便于单测）。
 *
 * 引擎返回的连接清单可能带重复行——同一连接被列多次（表格里 id 重复），
 * 或同名连接持有不同 id（引擎存储残留、同名重复写入）。两种都会让 UI
 * 出现「重复的连接信息」，故此处按 **id 优先、name 兜底** 双键去重：
 * 首次出现的行胜出（保留引擎原始顺序），后续同 id 或同 name 的行丢弃。
 *
 * id 为空串时只按 name 去重（不能让多条空 id 互相判重）；name 也为空的
 * 异常行一律保留，交由上层原样展示，避免静默吞掉引擎异常输出。
 */
export function dedupeConnections(connections: readonly DbConnection[]): DbConnection[] {
	const seenIds = new Set<string>();
	const seenNames = new Set<string>();
	const unique: DbConnection[] = [];
	for (const connection of connections) {
		const id = connection.id.trim();
		const name = connection.name.trim();
		if (!id && !name) {
			unique.push(connection);
			continue;
		}
		if ((id && seenIds.has(id)) || (name && seenNames.has(name))) continue;
		if (id) seenIds.add(id);
		if (name) seenNames.add(name);
		unique.push(connection);
	}
	return unique;
}

export const databaseService = {
	/** 列出全部连接（引擎重复行已去重，见 dedupeConnections）。 */
	async listConnections(): Promise<DatabaseResult<DbConnection[]>> {
		try {
			const client = getDbxMcpClient();
			const result = await client.callTool("dbx_list_connections", {});
			const text = textOf(result);
			if (result.isError) return err(classifyError(text));

			// W4-② 连接环境标记由 Astravia 产品层维护（desktop-config），缺省 dev。
			const envMap = readConfigSync().database?.connectionEnv ?? {};
			const { rows } = parseMarkdownTable(text);
			const connections: DbConnection[] = rows.map((row) => ({
				id: pick(row, ["ID", "Id", "id"]),
				name: pick(row, ["Name", "name"]),
				groupPath: pick(row, ["Group Path", "GroupPath", "group"]),
				type: pick(row, ["Type", "type", "DB Type"]),
				host: pick(row, ["Host", "host"]),
				port: Number(pick(row, ["Port", "port"])) || 0,
				database: pick(row, ["Database", "database", "DB"]),
				env: envMap[pick(row, ["Name", "name"])] ?? "dev",
			}));
			return ok(dedupeConnections(connections));
		} catch (e) {
			return err(toDatabaseError(e));
		}
	},

	/** 新增连接。 */
	async addConnection(params: DbAddConnectionParams): Promise<DatabaseResult<{ id: string; name: string }>> {
		try {
			const client = getDbxMcpClient();
			// dbx 的 add_connection 参数名与稳定接口不同，这里做映射
			const dbxArgs: Record<string, unknown> = {
				name: params.name,
				db_type: params.dbType,
				host: params.host,
			};
			if (params.port) dbxArgs.port = params.port;
			if (params.username) dbxArgs.username = params.username;
			if (params.password) dbxArgs.password = params.password;
			if (params.database) dbxArgs.database = params.database;
			dbxArgs.ssl = params.ssl ?? false;

			const result = await client.callTool("dbx_add_connection", dbxArgs);
			const text = textOf(result);
			if (result.isError) return err(classifyError(text));

			// W4-② 环境标记落 desktop-config（dev 为缺省值，仅 prod 需要显式写入）。
			if (params.env === "prod") {
				const config = readConfigSync();
				await writeDesktopConfig({
					...config,
					database: {
						...config.database,
						connectionEnv: { ...(config.database?.connectionEnv ?? {}), [params.name]: "prod" },
					},
				});
			}

			// 返回的文本可能是 "Connection added" 之类的确认，也可能含 id
			const idMatch = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
			return ok({ id: idMatch?.[0] ?? "", name: params.name });
		} catch (e) {
			return err(toDatabaseError(e));
		}
	},

	/** 测试连接：已保存连接直接列表，未保存草稿走「临时新增 → 列表 → 删除」。 */
	async testConnection(input: DbTestConnectionParams): Promise<DatabaseResult<DbConnectionTestResult>> {
		try {
			const client = getDbxMcpClient();
			let connectionName = input.connectionName;
			let tempName: string | null = null;
			if (input.draft) {
				tempName = `astravia-test-${randomUUID().slice(0, 8)}`;
				const addResult = await this.addConnection({ ...input.draft, name: tempName });
				if (!addResult.ok) return addResult;
				connectionName = tempName;
			}
			if (!connectionName) {
				return err({ code: "UNKNOWN", detail: "Missing connection selector" });
			}
			try {
				const result = await client.callTool("dbx_list_tables", { connection_name: connectionName });
				const text = textOf(result);
				if (result.isError) return err(classifyError(text));
				return ok({ tableCount: parseTableList(text).length, detail: text });
			} finally {
				if (tempName) {
					// 测试草稿的临时连接在成功或失败后都要清理。
					await this.removeConnection(tempName);
				}
			}
		} catch (e) {
			return err(toDatabaseError(e));
		}
	},

	/** 删除连接。 */
	async removeConnection(id: string): Promise<DatabaseResult<void>> {
		try {
			const client = getDbxMcpClient();
			// dbx 按 name 删除（连接名全局唯一）
			const result = await client.callTool("dbx_remove_connection", { connection_name: id });
			if (result.isError) return err(classifyError(textOf(result)));

			// W4-② 同步清理产品层维护的环境标记与生产写授权，避免悬空条目。
			const config = readConfigSync();
			const connectionEnv = { ...(config.database?.connectionEnv ?? {}) };
			const prodWriteApproved = { ...(config.database?.prodWriteApproved ?? {}) };
			delete connectionEnv[id];
			delete prodWriteApproved[id];
			await writeDesktopConfig({ ...config, database: { ...config.database, connectionEnv, prodWriteApproved } });
			return ok(undefined);
		} catch (e) {
			return err(toDatabaseError(e));
		}
	},

	/** 列出连接下全部表。 */
	async listTables(connectionName: string): Promise<DatabaseResult<DbTableInfo[]>> {
		try {
			const client = getDbxMcpClient();
			const result = await client.callTool("dbx_list_tables", { connection_name: connectionName });
			const text = textOf(result);
			if (result.isError) return err(classifyError(text));

			return ok(parseTableList(text));
		} catch (e) {
			return err(toDatabaseError(e));
		}
	},

	/** 查看表结构。 */
	async describeTable(connectionName: string, table: string): Promise<DatabaseResult<DbColumnInfo[]>> {
		try {
			const client = getDbxMcpClient();
			const result = await client.callTool("dbx_describe_table", { connection_name: connectionName, table });
			const text = textOf(result);
			if (result.isError) return err(classifyError(text));

			const { rows } = parseMarkdownTable(text);
			const columns = parseDescribeColumns(rows);
			return ok(columns);
		} catch (e) {
			return err(toDatabaseError(e));
		}
	},

	/** 执行查询（SELECT），返回结构化结果。B3.2 起写语句（INSERT/UPDATE/DELETE）同样走此链路，并记录审计日志。 */
	async executeQuery(connectionName: string, sql: string): Promise<DatabaseResult<DbQueryResult>> {
		try {
			// B3.1-① 写保护拦截（不触达引擎）：strict 模式所有连接写需授权；DDL/多语句保守拦截。
			const dbConfig = readConfigSync().database;
			const env = dbConfig?.connectionEnv?.[connectionName] ?? "dev";
			const writeApproved = dbConfig?.prodWriteApproved?.[connectionName] === true;
			const safetyMode = dbConfig?.safetyMode ?? "strict";
			const isWrite = isWriteStatement(sql);
			if (isWrite) auditWrite("info", `[write-audit] start connection="${connectionName}" env=${env} sql=${sql}`);
			const blocked = maybeBlockWrite({ env, writeApproved, safetyMode, sql });
			if (blocked) {
				if (isWrite)
					auditWrite(
						"warn",
						`[write-audit] blocked connection="${connectionName}" env=${env} code=${blocked.code} sql=${sql}`,
					);
				return err(blocked);
			}

			// B3.1-②-B 查询超时：引擎调用超时由 dbx-mcp-client 控制（超时返回 TIMEOUT）。
			const queryTimeoutMs = dbConfig?.queryTimeoutMs ?? 30_000;
			const client = getDbxMcpClient();
			const result = await client.callTool(
				"dbx_execute_query",
				{ connection_name: connectionName, sql },
				queryTimeoutMs,
			);
			const text = textOf(result);
			if (result.isError) return err(classifyError(text));

			const { columns, rows } = parseMarkdownTable(text);
			// B3.1-②-A 行数上限：引擎最多返回 100 行，产品层按 rowLimit 截断并标记（UI 提示）。
			const rowLimit = dbConfig?.rowLimit ?? 100;
			const truncated = rows.length > rowLimit;
			const visibleRows = truncated ? rows.slice(0, rowLimit) : rows;
			const durationMatch = text.match(/(\d+)\s*(ms|s)\b/i);
			if (isWrite)
				auditWrite(
					"info",
					`[write-audit] ok connection="${connectionName}" env=${env} rows=${visibleRows.length} sql=${sql}`,
				);
			return ok({
				columns,
				rows: visibleRows,
				rowCount: visibleRows.length,
				durationMs: durationMatch?.[0] ?? "",
				rawText: text,
				truncated,
			});
		} catch (e) {
			return err(toDatabaseError(e));
		}
	},

	/** 获取连接 schema 上下文（供 AI 注入使用）。 */
	async getSchemaContext(connectionName: string): Promise<DatabaseResult<string>> {
		try {
			const client = getDbxMcpClient();
			const result = await client.callTool("dbx_get_schema_context", { connection_name: connectionName });
			const text = textOf(result);
			if (result.isError) return err(classifyError(text));
			return ok(text);
		} catch (e) {
			return err(toDatabaseError(e));
		}
	},
};

/** 把任意异常折算成稳定的 DatabaseError。 */
function toDatabaseError(e: unknown): DatabaseError {
	if (e instanceof Error) {
		if (e.message.includes("timeout")) return { code: "TIMEOUT", detail: e.message };
		return { code: "UNKNOWN", detail: `${e.name}: ${e.message}` };
	}
	return { code: "UNKNOWN", detail: String(e) };
}
