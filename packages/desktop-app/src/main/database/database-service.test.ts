import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseService, parseDescribeColumns, parseTableList } from "./database-service.js";

/**
 * database-service 集成测试（真实调用 dbx-mcp.exe）。
 * 测试自建临时 SQLite 连接，结束后清理，不依赖既有连接存储。
 */

// 测试在仓库根运行，cwd 不是 packages/desktop-app；固定返回真实二进制路径
vi.mock("../mcp/dbx-mcp-path.js", () => ({
	resolveDbxMcpBinaryPath: () =>
		"E:/open-source-projects/astravia/packages/desktop-app/resources/dbx-mcp/win32-x64/dbx-mcp.exe",
}));
vi.mock("electron", () => ({
	app: { isPackaged: false },
}));

const TEST_DB_PATH = "E:/open-source-projects/astravia/test-db/astravia-test.db";
const connectionName = `astravia-test-${Date.now()}`;

beforeAll(async () => {
	const result = await databaseService.addConnection({
		name: connectionName,
		dbType: "sqlite",
		host: TEST_DB_PATH,
	});
	if (!result.ok) throw new Error(`test setup failed: ${result.error.detail}`);
});

describe("parseTableList（纯函数，兼容 dbx 各返回格式）", () => {
	it("基础格式 `- users (BASE TABLE)`", () => {
		const tables = parseTableList("- users (BASE TABLE)\n- orders (BASE TABLE)");
		expect(tables).toEqual([
			{ name: "users", kind: "BASE TABLE" },
			{ name: "orders", kind: "BASE TABLE" },
		]);
	});

	it("PostgreSQL 带注释后缀 `-- 物业费`（bug 回归用例）", () => {
		const tables = parseTableList(
			"- dwd_property_fees_collection_details (BASE TABLE) -- 物业费\n- users (BASE TABLE)",
		);
		expect(tables).toEqual([
			{ name: "dwd_property_fees_collection_details", kind: "BASE TABLE" },
			{ name: "users", kind: "BASE TABLE" },
		]);
	});

	it("注释与类型间无空格等变体", () => {
		const tables = parseTableList("- t1 (BASE TABLE)--note\n- t2 (VIEW) -- 视图");
		expect(tables).toEqual([
			{ name: "t1", kind: "BASE TABLE" },
			{ name: "t2", kind: "VIEW" },
		]);
	});

	it("无类型行兜底为 kind 空串", () => {
		expect(parseTableList("- users")).toEqual([{ name: "users", kind: "" }]);
	});

	it("Markdown 表格兜底（中英文列名）", () => {
		const tables = parseTableList("| Name | Type |\n| --- | --- |\n| users | BASE TABLE |\n| orders | VIEW |");
		expect(tables).toEqual([
			{ name: "users", kind: "BASE TABLE" },
			{ name: "orders", kind: "VIEW" },
		]);
	});
});

describe("databaseService 集成（真实 dbx-mcp）", () => {
	it("listConnections 返回连接列表（含临时测试连接）", async () => {
		const result = await databaseService.listConnections();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(Array.isArray(result.data)).toBe(true);
		expect(result.data.some((c) => c.name === connectionName)).toBe(true);
	});

	it("listTables 返回 users 表", async () => {
		const result = await databaseService.listTables(connectionName);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.some((t) => t.name === "users")).toBe(true);
	});

	it("describeTable 返回列结构（含 id 主键）", async () => {
		const result = await databaseService.describeTable(connectionName, "users");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.some((c) => c.name === "id" && c.isPrimaryKey)).toBe(true);
		expect(result.data.some((c) => c.name === "name")).toBe(true);
	});

	it("executeQuery 返回结构化行数据", async () => {
		const result = await databaseService.executeQuery(connectionName, "SELECT * FROM users");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.columns).toContain("id");
		expect(result.data.columns).toContain("name");
		expect(result.data.rowCount).toBeGreaterThan(0);
		expect(result.data.rows[0]).toHaveProperty("name");
	});

	it("testConnection 对已保存连接返回可读表数量", async () => {
		const result = await databaseService.testConnection({ connectionName });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.tableCount).toBeGreaterThan(0);
	});

	it("testConnection 草稿成功后会清理临时连接", async () => {
		const result = await databaseService.testConnection({
			draft: { name: `draft-${Date.now()}`, dbType: "sqlite", host: TEST_DB_PATH },
		});
		expect(result.ok).toBe(true);
		const listResult = await databaseService.listConnections();
		expect(listResult.ok).toBe(true);
		if (listResult.ok) {
			expect(listResult.data.filter((c) => c.name.startsWith("astravia-test-")).length).toBe(1);
		}
	});

	it("testConnection 草稿失败返回 CONNECTION_FAILED", async () => {
		const result = await databaseService.testConnection({
			draft: {
				name: `bad-${Date.now()}`,
				dbType: "postgres",
				host: "127.0.0.1",
				port: 59999,
				database: "postgres",
			},
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("CONNECTION_FAILED");
	});

	it("DDL 被应用层安全策略拦截 → DDL_BLOCKED（B3.1-①-D 优先于引擎 SQL_BLOCKED）", async () => {
		const result = await databaseService.executeQuery(connectionName, "DROP TABLE users");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("DDL_BLOCKED");
	});

	it("strict 模式（缺省）dev 连接写语句被拦截 → WRITE_BLOCKED（B3.1-①-B）", async () => {
		const result = await databaseService.executeQuery(connectionName, "INSERT INTO users (name) VALUES ('x')");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("WRITE_BLOCKED");
	});

	it("不存在的连接 → CONNECTION_NOT_FOUND", async () => {
		const result = await databaseService.listTables("no-such-connection-xyz");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("CONNECTION_NOT_FOUND");
	});
});

// B3.2-R parseDescribeColumns（纯函数）：主键检测多格式兼容（SQLite `(PK)` / 独立 Key 列 / Comment 标记）。
describe("parseDescribeColumns（主键多格式检测）", () => {
	it("SQLite 格式：列名内嵌 `(PK)` 识别并清理列名", () => {
		const columns = parseDescribeColumns([
			{ Column: "id (PK)", Type: "INTEGER" },
			{ Column: "name", Type: "TEXT" },
		]);
		expect(columns.map((c) => [c.name, c.isPrimaryKey])).toEqual([
			["id", true],
			["name", false],
		]);
	});

	it("MySQL 格式：独立 Key 列 PRI 识别为主键", () => {
		const columns = parseDescribeColumns([
			{ Column: "id", Type: "bigint", Key: "PRI" },
			{ Column: "name", Type: "varchar", Key: "" },
		]);
		expect(columns.map((c) => c.isPrimaryKey)).toEqual([true, false]);
	});

	it("PostgreSQL 格式：KeyType PRIMARY KEY / Comment PRIMARY KEY 识别", () => {
		const byKeyType = parseDescribeColumns([{ Column: "id", Type: "int8", KeyType: "PRIMARY KEY" }]);
		expect(byKeyType[0]?.isPrimaryKey).toBe(true);
		const byComment = parseDescribeColumns([{ Column: "id", Type: "int8", Comment: "PRIMARY KEY" }]);
		expect(byComment[0]?.isPrimaryKey).toBe(true);
	});

	it("列名 `(PRIMARY KEY)` 内嵌标记清理列名", () => {
		const columns = parseDescribeColumns([{ Column: "id (PRIMARY KEY)", Type: "int8" }]);
		expect(columns[0]).toMatchObject({ name: "id", isPrimaryKey: true });
	});

	it("无任何主键标记 → 非主键（keyless 表退化为整行等值定位）", () => {
		const columns = parseDescribeColumns([
			{ Column: "a", Type: "int" },
			{ Column: "b", Type: "text", Comment: "普通备注" },
		]);
		expect(columns.every((c) => !c.isPrimaryKey)).toBe(true);
	});
});

afterAll(async () => {
	await databaseService.removeConnection(connectionName);
	// 释放 dbx-mcp 子进程，避免测试残留
	const { disposeDbxMcpClient } = await import("./dbx-mcp-client.js");
	await disposeDbxMcpClient();
});
