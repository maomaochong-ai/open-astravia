import { DbxMcpClient } from "./dbx-mcp-client.js";

/**
 * 单发确认写通道（批次3，任务 #6 confirmed-binding）。
 *
 * 原理：dbx 引擎（backend.rs）支持 DBX_MCP_CONFIRMED_WRITE_SQL 进程级 env 绑定 ——
 * 危险写（DDL / 写语句）只有与绑定值「归一化后精确匹配」才放行，否则返回 SQL_BLOCKED。
 *
 * Astravia 常驻连接子进程不携带该 env（无任何提升权限）。用户在工作台确认一次
 * 危险 SQL 后，走本通道：以绑定 env 拉起**独立单发子进程**，仅执行与绑定精确匹配的
 * 这一条语句，随后立即释放。进程级绑定使「确认 A 后执行 B」在引擎侧被拒绝。
 */
export const CONFIRMED_WRITE_ENV = "DBX_MCP_CONFIRMED_WRITE_SQL";

export interface ConfirmedWriteRunOptions {
	connectionName: string;
	/** 本次精确执行的 SQL（同时作为引擎绑定值；归一化由引擎执行）。 */
	sql: string;
	queryTimeoutMs?: number;
	/** 测试注入：自定义客户端工厂（默认拉起带绑定 env 的单发子进程）。 */
	clientFactory?: () => DbxMcpClient;
}

export async function runConfirmedWriteSql(
	options: ConfirmedWriteRunOptions,
): Promise<import("./dbx-mcp-client.js").DbxToolResult> {
	const createClient =
		options.clientFactory ?? (() => new DbxMcpClient({ extraEnv: { [CONFIRMED_WRITE_ENV]: options.sql } }));
	const client = createClient();
	try {
		await client.ensureInitialized();
		return await client.callTool(
			"dbx_execute_query",
			{ connection_name: options.connectionName, sql: options.sql },
			options.queryTimeoutMs,
		);
	} finally {
		await client.dispose();
	}
}
