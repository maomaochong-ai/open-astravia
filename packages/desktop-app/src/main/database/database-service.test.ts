import { copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findTestDbxMcpBinaryPath } from "../mcp/dbx-mcp-test-path.js";
import { databaseService, parseDescribeColumns, parseTableList } from "./database-service.js";
import { disposeDbxMcpClient } from "./dbx-mcp-client.js";
import {
	buildDatabaseSchemaPrompt,
	clearSchemaContextCache,
	databaseSchemaContextIo,
} from "./schema-context-injection.js";

/**
 * database-service 集成测试（真实调用 dbx-mcp.exe）。
 * 测试自建临时 SQLite 连接，结束后清理，不依赖既有连接存储。
 */

// 真实二进制由 dbx-mcp-test-path.ts 按平台动态解析（任意 cwd），缺失时集成套件 skipIf 跳过
vi.mock("../mcp/dbx-mcp-path.js", async () => {
	const { resolveTestDbxMcpBinaryPath } = await import("../mcp/dbx-mcp-test-path.js");
	return { resolveDbxMcpBinaryPath: resolveTestDbxMcpBinaryPath };
});
vi.mock("electron", () => ({
	app: { isPackaged: false },
}));

const connectionName = `astravia-test-${Date.now()}`;
const testDbxMcpAvailable = findTestDbxMcpBinaryPath() !== null;

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

describe.skipIf(!testDbxMcpAvailable)("databaseService 集成（真实 dbx-mcp）", () => {
	// 预置 fixture：dbx 引擎的 sqlite 连接要求文件已存在，故提交含 users 表的只读夹具库
	// （fixtures/astravia-test.sqlite，由仓库维护、与测试同目录，经 import.meta.url 解析以支持任意 cwd）
	const fixturePath = fileURLToPath(new URL("./fixtures/astravia-test.sqlite", import.meta.url));

	beforeAll(async () => {
		const result = await databaseService.addConnection({
			name: connectionName,
			dbType: "sqlite",
			host: fixturePath,
		});
		if (!result.ok) throw new Error(`test setup failed: ${result.error.detail}`);
	}, 30000);

	afterAll(async () => {
		await databaseService.removeConnection(connectionName);
		// 释放 dbx-mcp 子进程，避免测试残留
		await disposeDbxMcpClient();
	});

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
			draft: { name: `draft-${Date.now()}`, dbType: "sqlite", host: fixturePath },
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

// B2.5 schema 注入链路集成 —— 与 databaseService 集成同文件：
// 真实 dbx-mcp 引擎 spawn 与连接持久化（desktop-config-store）会在 vitest 文件级并行下
// 相互干扰，此前独立的 schema-context-injection.integration.test.ts 与本文件并发时
// 必然有一个 setup 失败；同文件内 describe 串行执行，与其他纯函数测试文件并行安全。
// 引擎 client 为单例，databaseService 套件 afterAll 已 dispose，此处会懒重建新进程。
describe.skipIf(!testDbxMcpAvailable)("buildDatabaseSchemaPrompt 集成（真实 dbx-mcp）", () => {
	const schemaConnectionName = `astravia-schema-test-${Date.now()}`;

	beforeAll(async () => {
		const result = await databaseService.addConnection({
			name: schemaConnectionName,
			dbType: "sqlite",
			host: fileURLToPath(new URL("./fixtures/astravia-test.sqlite", import.meta.url)),
		});
		if (!result.ok) throw new Error(`test setup failed: ${result.error.detail}`);
	}, 30000);

	afterAll(async () => {
		clearSchemaContextCache();
		await databaseService.removeConnection(schemaConnectionName);
		await disposeDbxMcpClient();
	});

	it("真实引擎下能取回连接 schema 并组装注入块", async () => {
		const prompt = await buildDatabaseSchemaPrompt(databaseSchemaContextIo);
		expect(prompt).toBeDefined();
		expect(prompt).toContain(`连接「${schemaConnectionName}」`);
		expect(prompt).toContain("users");
		expect(prompt).toContain("dbx_execute_query");
	}, 30000);

	it("重复调用命中缓存，引擎只被调用一次（连接列表 + schema 各一次）", async () => {
		clearSchemaContextCache();
		await buildDatabaseSchemaPrompt(databaseSchemaContextIo);
		const first = await buildDatabaseSchemaPrompt(databaseSchemaContextIo);
		expect(first).toBeDefined();
	}, 30000);
});

// 批次3（任务 #6）confirmed-binding：UI 危险确认后，语句经带 DBX_MCP_CONFIRMED_WRITE_SQL
// 绑定 env 的单发子进程执行（进程级「确认 A 只能执行 A」），不再走常驻进程。
// 用例对 tmp 复制的夹具库执行 CREATE TABLE，验证放行链路与快照不一致拦截。
describe.skipIf(!testDbxMcpAvailable)("confirmed-binding 单发写通道（真实 dbx-mcp）", () => {
	const bindingConnectionName = `astravia-binding-${Date.now()}`;
	const tmpDbPath = join(tmpdir(), `astravia-binding-${Date.now()}.sqlite`);

	beforeAll(async () => {
		const sourceFixture = fileURLToPath(new URL("./fixtures/astravia-test.sqlite", import.meta.url));
		copyFileSync(sourceFixture, tmpDbPath);
		const result = await databaseService.addConnection({
			name: bindingConnectionName,
			dbType: "sqlite",
			host: tmpDbPath,
		});
		if (!result.ok) throw new Error(`binding test setup failed: ${result.error.detail}`);
	}, 30000);

	afterAll(async () => {
		await databaseService.removeConnection(bindingConnectionName);
		rmSync(tmpDbPath, { force: true });
		await disposeDbxMcpClient();
	});

	it("确认放行后 CREATE TABLE 经单发绑定通道执行成功，并可读回", async () => {
		const ddl = "CREATE TABLE confirmed_probe (id INTEGER PRIMARY KEY, note TEXT)";
		const result = await databaseService.executeQuery(bindingConnectionName, ddl, {
			confirmedWrite: true,
			confirmedSql: ddl,
		});
		if (!result.ok) {
			// eslint-disable-next-line no-console
			console.error("binding run detail:", result.error.code, result.error.detail);
		}
		expect(result.ok).toBe(true);
		const list = await databaseService.executeQuery(
			bindingConnectionName,
			"SELECT name FROM sqlite_master WHERE type='table' AND name='confirmed_probe'",
		);
		expect(list.ok).toBe(true);
		if (list.ok) {
			expect(JSON.stringify(list.data.rows)).toContain("confirmed_probe");
		}
	}, 30000);

	it("确认快照与执行语句不一致 → CONFIRM_MISMATCH，且未创建表", async () => {
		const executed = "CREATE TABLE confirmed_sneaky (id INTEGER)";
		const result = await databaseService.executeQuery(bindingConnectionName, executed, {
			confirmedWrite: true,
			// UI 确认的是另一条语句：应用层立即拒绝，单发子进程不被拉起。
			confirmedSql: "DROP TABLE confirmed_sneaky",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("CONFIRM_MISMATCH");
		}
		const list = await databaseService.executeQuery(
			bindingConnectionName,
			"SELECT name FROM sqlite_master WHERE type='table' AND name='confirmed_sneaky'",
		);
		expect(list.ok).toBe(true);
		if (list.ok) {
			expect(JSON.stringify(list.data.rows)).not.toContain("confirmed_sneaky");
		}
	}, 30000);
});
