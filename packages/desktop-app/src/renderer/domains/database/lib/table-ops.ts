// 表级操作套件（表套件）：
// - 危险操作语句构建：TRUNCATE / DROP / RENAME（方言感知，供一次性确认写通道执行）
// - 只读导出辅助：CSV / JSON 序列化与文件名
// 纯函数模块，不依赖 UI 与主进程，便于独立单测。

import { buildOpenTableSql, quoteIdentifier } from "./sql-dialect";

/** 树节点给出的表定位信息（schema 可缺省）。 */
export interface TableTarget {
	dbType: string;
	table: string;
	schema?: string;
}

export type TableDangerOp = "truncate" | "drop" | "rename";

/** 读取表前 N 行的 SQL（复用开放式表语句，带分页 LIMIT）。 */
export function buildExportSelectSql(target: TableTarget, limit = 100): string {
	return buildOpenTableSql(target.dbType, target.table, limit, 0, target.schema);
}

function tableRef(target: TableTarget): string {
	const id = quoteIdentifier(target.dbType, target.table);
	return target.schema ? `${quoteIdentifier(target.dbType, target.schema)}.${id}` : id;
}

/** 危险操作可执行语句；RENAME 需要 newName，SQL Server 走 sp_rename。 */
export function buildDangerOpSql(target: TableTarget, op: TableDangerOp, newName?: string): string {
	const ref = tableRef(target);
	switch (op) {
		case "truncate":
			return `TRUNCATE TABLE ${ref}`;
		case "drop":
			return `DROP TABLE ${ref}`;
		case "rename": {
			if (!newName || newName.trim() === "") {
				throw new Error("rename requires a non-empty new table name");
			}
			const lower = target.dbType.toLowerCase();
			if (lower === "sqlserver" || lower === "mssql") {
				// sp_rename 接收裸表名（不含库限定），此处保持与表套件一致的最小形式。
				return `EXEC sp_rename '${target.table}', '${newName.trim()}'`;
			}
			return `ALTER TABLE ${ref} RENAME TO ${quoteIdentifier(target.dbType, newName.trim())}`;
		}
	}
}

export function dangerOpLabel(op: TableDangerOp): string {
	switch (op) {
		case "truncate":
			return "TRUNCATE";
		case "drop":
			return "DROP";
		case "rename":
			return "RENAME";
	}
}

/** 危险操作确认消息中需要用户输入的标识符名词（用于本地输入框提示）。 */
export function dangerOpKeyword(op: TableDangerOp): string {
	switch (op) {
		case "truncate":
			return "TRUNCATE";
		case "drop":
			return "DROP";
		case "rename":
			return "RENAME";
	}
}

/** 表格数据视图：列 + 行（单元格为字符串或 null）。 */
export interface FlatTableData {
	columns: string[];
	rows: Record<string, string | null>[];
}

function csvEscape(value: string | null): string {
	if (value == null) return "";
	const s = String(value);
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 风格 CSV：统一 CRLF、必要时引号包裹并转义双引号。 */
export function toCsv(data: FlatTableData): string {
	const header = data.columns.map(csvEscape).join(",");
	const lines = data.rows.map((row) => data.columns.map((col) => csvEscape(row[col] ?? null)).join(","));
	return `${[header, ...lines].join("\r\n")}\r\n`;
}

/** 带列定义的 JSON 导出（比裸行数组更利于回读与结构校验）。 */
export function toJson(data: FlatTableData): string {
	return JSON.stringify({ columns: data.columns, rows: data.rows }, null, 2);
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

/** 导出文件名：<表名>_<日期>.<ext> */
export function exportFileName(table: string, ext: "csv" | "json"): string {
	const d = new Date();
	const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	return `${table}_${date}.${ext}`;
}
