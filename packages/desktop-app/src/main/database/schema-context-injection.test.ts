import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildDatabaseSchemaPrompt,
	buildSqlExamples,
	clearSchemaContextCache,
	firstTableName,
	formatTableSchema,
	renderSchemaContextBlock,
	SCHEMA_CONTEXT_CHAR_LIMIT_PER_CONNECTION,
	type SchemaContextIo,
	summarizeSchema,
} from "./schema-context-injection.js";

function makeIo(overrides: Partial<SchemaContextIo> = {}): SchemaContextIo & {
	listConnections: ReturnType<typeof vi.fn>;
	getSchemaContext: ReturnType<typeof vi.fn>;
	getTableSchemaContext: ReturnType<typeof vi.fn>;
} {
	return {
		listConnections: vi.fn(async () => [{ name: "astravia-test" }]),
		getSchemaContext: vi.fn(async () => "users (id INTEGER PK, name TEXT)\ndepartments (id INTEGER PK, name TEXT)"),
		getTableSchemaContext: vi.fn(
			async (_connection: string, table: string) => `${table} (\n  id INTEGER PRIMARY KEY\n)`,
		),
		...overrides,
	} as never;
}

describe("summarizeSchema", () => {
	it("短文本原样返回", () => {
		expect(summarizeSchema("users (id INTEGER)")).toBe("users (id INTEGER)");
	});

	it("超限文本截断并保留截断提示", () => {
		const long = "x".repeat(SCHEMA_CONTEXT_CHAR_LIMIT_PER_CONNECTION + 500);
		const result = summarizeSchema(long);
		expect(result.length).toBeLessThan(long.length);
		expect(result.startsWith("x".repeat(SCHEMA_CONTEXT_CHAR_LIMIT_PER_CONNECTION))).toBe(true);
		expect(result).toContain("已截断");
	});
});

describe("formatTableSchema", () => {
	it("格式化列结构（类型/主键/非空/默认/注释）", () => {
		const text = formatTableSchema("users", [
			{
				name: "id",
				type: "INTEGER",
				nullable: false,
				hasDefault: false,
				defaultValue: "",
				comment: "",
				isPrimaryKey: true,
			},
			{
				name: "name",
				type: "TEXT",
				nullable: true,
				hasDefault: false,
				defaultValue: "",
				comment: "用户名",
				isPrimaryKey: false,
			},
			{
				name: "created_at",
				type: "TEXT",
				nullable: false,
				hasDefault: true,
				defaultValue: "CURRENT_TIMESTAMP",
				comment: "",
				isPrimaryKey: false,
			},
		]);
		expect(text).toBe(
			"users (\n  id INTEGER PRIMARY KEY NOT NULL\n  name TEXT -- 用户名\n  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n)",
		);
	});

	it("缺类型的列回退 unknown", () => {
		const text = formatTableSchema("t", [
			{ name: "x", type: "", nullable: true, hasDefault: false, defaultValue: "", comment: "", isPrimaryKey: false },
		]);
		expect(text).toContain("x unknown");
	});
});

describe("renderSchemaContextBlock", () => {
	it("空条目返回空串", () => {
		expect(renderSchemaContextBlock([])).toBe("");
	});

	it("组装多连接块并包含连接名", () => {
		const block = renderSchemaContextBlock([
			{ connectionName: "a", schema: "t1 (id INTEGER)" },
			{ connectionName: "b", schema: "t2 (name TEXT)" },
		]);
		expect(block).toContain("连接「a」");
		expect(block).toContain("连接「b」");
		expect(block).toContain("dbx_execute_query");
		expect(block).toContain("connection_name");
	});

	it("表级条目渲染为「连接 x 表 y」标题（B2.10-W4-①）", () => {
		const block = renderSchemaContextBlock([
			{ connectionName: "a", tableName: "users", schema: "users (\n  id INTEGER\n)" },
		]);
		expect(block).toContain("连接「a」表「users」");
		expect(block).not.toContain("连接「a」\n");
	});

	it("executeToolAvailable=false 时不指示调用 dbx 工具（B2.10-W3）", () => {
		const block = renderSchemaContextBlock([{ connectionName: "a", schema: "t1 (id INTEGER)" }], {
			executeToolAvailable: false,
		});
		expect(block).toContain("连接「a」");
		expect(block).toContain("AI 访问");
		expect(block).not.toContain("dbx_execute_query");
		expect(block).not.toContain("connection_name");
	});
});

describe("buildDatabaseSchemaPrompt", () => {
	beforeEach(() => {
		clearSchemaContextCache();
	});

	it("无连接时返回 undefined", async () => {
		const io = makeIo({ listConnections: vi.fn(async () => []) });
		await expect(buildDatabaseSchemaPrompt(io)).resolves.toBeUndefined();
		expect(io.getSchemaContext).not.toHaveBeenCalled();
	});

	it("注入成功连接 schema", async () => {
		const io = makeIo();
		const prompt = await buildDatabaseSchemaPrompt(io);
		expect(prompt).toBeDefined();
		expect(prompt).toContain("连接「astravia-test」");
		expect(prompt).toContain("users");
		expect(io.getSchemaContext).toHaveBeenCalledWith("astravia-test");
	});

	it("单连接失败时静默跳过，其余连接正常注入", async () => {
		const io = makeIo({
			listConnections: vi.fn(async () => [{ name: "ok-conn" }, { name: "bad-conn" }]),
			getSchemaContext: vi.fn(async (name: string) => {
				if (name === "bad-conn") throw new Error("DBX_NOT_RUNNING");
				return "ok (id INTEGER)";
			}),
		});
		const prompt = await buildDatabaseSchemaPrompt(io);
		expect(prompt).toContain("连接「ok-conn」");
		expect(prompt).not.toContain("bad-conn");
	});

	it("全部失败时返回 undefined 且不抛错", async () => {
		const io = makeIo({
			getSchemaContext: vi.fn(async () => {
				throw new Error("connection failed");
			}),
		});
		await expect(buildDatabaseSchemaPrompt(io)).resolves.toBeUndefined();
	});

	it("listConnections 失败时返回 undefined 且不抛错", async () => {
		const io = makeIo({
			listConnections: vi.fn(async () => {
				throw new Error("engine not running");
			}),
		});
		await expect(buildDatabaseSchemaPrompt(io)).resolves.toBeUndefined();
	});

	it("TTL 内重复调用命中缓存，不重复打 io", async () => {
		const io = makeIo();
		await buildDatabaseSchemaPrompt(io);
		await buildDatabaseSchemaPrompt(io);
		expect(io.getSchemaContext).toHaveBeenCalledTimes(1);
	});

	it("清理缓存后重新获取", async () => {
		const io = makeIo();
		await buildDatabaseSchemaPrompt(io);
		clearSchemaContextCache();
		await buildDatabaseSchemaPrompt(io);
		expect(io.getSchemaContext).toHaveBeenCalledTimes(2);
	});

	it("空 schema 文本的连接被跳过", async () => {
		const io = makeIo({
			getSchemaContext: vi.fn(async () => "   "),
		});
		await expect(buildDatabaseSchemaPrompt(io)).resolves.toBeUndefined();
	});

	// ---- B2.10-W4-① 感知范围 ----

	it("scope=connections 只注入白名单连接", async () => {
		const io = makeIo({
			listConnections: vi.fn(async () => [{ name: "a" }, { name: "b" }, { name: "c" }]),
			getSchemaContext: vi.fn(async (name: string) => `${name} (id INTEGER)`),
		});
		const prompt = await buildDatabaseSchemaPrompt(io, {
			scope: { scope: "connections", connections: ["a", "c"], tables: [] },
		});
		expect(prompt).toContain("连接「a」");
		expect(prompt).toContain("连接「c」");
		expect(prompt).not.toContain("连接「b」");
		expect(io.getSchemaContext).toHaveBeenCalledTimes(2);
	});

	it("scope=connections 白名单为空时不注入任何内容", async () => {
		const io = makeIo({
			listConnections: vi.fn(async () => [{ name: "a" }]),
			getSchemaContext: vi.fn(async () => "a (id INTEGER)"),
		});
		await expect(
			buildDatabaseSchemaPrompt(io, { scope: { scope: "connections", connections: [], tables: [] } }),
		).resolves.toBeUndefined();
		expect(io.getSchemaContext).not.toHaveBeenCalled();
	});

	it("scope=connections 白名单含不存在连接时忽略", async () => {
		const io = makeIo({
			listConnections: vi.fn(async () => [{ name: "a" }]),
			getSchemaContext: vi.fn(async () => "a (id INTEGER)"),
		});
		const prompt = await buildDatabaseSchemaPrompt(io, {
			scope: { scope: "connections", connections: ["a", "ghost"], tables: [] },
		});
		expect(prompt).toContain("连接「a」");
		expect(prompt).not.toContain("ghost");
	});

	it("scope=tables 只注入白名单表的表级 schema", async () => {
		const io = makeIo({
			getTableSchemaContext: vi.fn(async (_connection: string, table: string) => `${table} (\n  id INTEGER\n)`),
		});
		const prompt = await buildDatabaseSchemaPrompt(io, {
			scope: { scope: "tables", connections: [], tables: [{ connection: "a", table: "users" }] },
		});
		expect(prompt).toContain("连接「a」表「users」");
		expect(prompt).toContain("id INTEGER");
		expect(io.getTableSchemaContext).toHaveBeenCalledWith("a", "users");
		// 表级注入不经过连接级 IO
		expect(io.getSchemaContext).not.toHaveBeenCalled();
	});

	it("scope=tables 多表注入并各自独立", async () => {
		const io = makeIo({
			getTableSchemaContext: vi.fn(async (_connection: string, table: string) => `${table} (\n  id INTEGER\n)`),
		});
		const prompt = await buildDatabaseSchemaPrompt(io, {
			scope: {
				scope: "tables",
				connections: [],
				tables: [
					{ connection: "a", table: "users" },
					{ connection: "b", table: "orders" },
				],
			},
		});
		expect(prompt).toContain("连接「a」表「users」");
		expect(prompt).toContain("连接「b」表「orders」");
		expect(io.getTableSchemaContext).toHaveBeenCalledTimes(2);
	});

	it("scope=tables 空白名单返回 undefined", async () => {
		const io = makeIo();
		await expect(
			buildDatabaseSchemaPrompt(io, { scope: { scope: "tables", connections: [], tables: [] } }),
		).resolves.toBeUndefined();
		expect(io.getTableSchemaContext).not.toHaveBeenCalled();
	});

	it("scope=tables 单表失败静默跳过其余表", async () => {
		const io = makeIo({
			getTableSchemaContext: vi.fn(async (_connection: string, table: string) => {
				if (table === "bad") throw new Error("CONNECTION_NOT_FOUND");
				return `${table} (\n  id INTEGER\n)`;
			}),
		});
		const prompt = await buildDatabaseSchemaPrompt(io, {
			scope: {
				scope: "tables",
				connections: [],
				tables: [
					{ connection: "a", table: "ok" },
					{ connection: "a", table: "bad" },
				],
			},
		});
		expect(prompt).toContain("连接「a」表「ok」");
		expect(prompt).not.toContain("bad");
	});

	it("scope=tables 表级 schema 走独立缓存 key", async () => {
		const io = makeIo({
			getTableSchemaContext: vi.fn(async () => "t (\n  id INTEGER\n)"),
		});
		const opts: Parameters<typeof buildDatabaseSchemaPrompt>[1] = {
			scope: { scope: "tables", connections: [], tables: [{ connection: "a", table: "t" }] },
		};
		await buildDatabaseSchemaPrompt(io, opts);
		await buildDatabaseSchemaPrompt(io, opts);
		expect(io.getTableSchemaContext).toHaveBeenCalledTimes(1);
	});

	it("scope=all 与缺省行为一致", async () => {
		const io = makeIo({
			listConnections: vi.fn(async () => [{ name: "a" }, { name: "b" }]),
			getSchemaContext: vi.fn(async (name: string) => `${name} (id INTEGER)`),
		});
		const prompt = await buildDatabaseSchemaPrompt(io, {
			scope: { scope: "all", connections: [], tables: [] },
		});
		expect(prompt).toContain("连接「a」");
		expect(prompt).toContain("连接「b」");
	});

	// ---- B3.1-①-C 连接级 AI 访问白名单 ----

	it("prod 连接 connectionAiAccess[name]=false 时被排除", async () => {
		const io = makeIo({
			listConnections: vi.fn(async () => [
				{ name: "prod-db", env: "prod" as const },
				{ name: "dev-db", env: "dev" as const },
			]),
			getSchemaContext: vi.fn(async (name: string) => `${name} (id INTEGER)`),
		});
		const prompt = await buildDatabaseSchemaPrompt(io, {
			connectionAiAccess: { "prod-db": false },
			connectionEnv: { "prod-db": "prod", "dev-db": "dev" },
		});
		expect(prompt).toContain("连接「dev-db」");
		expect(prompt).not.toContain("prod-db");
		expect(io.getSchemaContext).toHaveBeenCalledTimes(1);
		expect(io.getSchemaContext).toHaveBeenCalledWith("dev-db");
	});

	it("prod 连接无显式白名单时按 env 缺省排除（prod 关）", async () => {
		const io = makeIo({
			listConnections: vi.fn(async () => [
				{ name: "prod-db", env: "prod" as const },
				{ name: "dev-db", env: "dev" as const },
			]),
			getSchemaContext: vi.fn(async (name: string) => `${name} (id INTEGER)`),
		});
		// 不传 connectionAiAccess，只用 connectionEnv —— prod 缺省关 / dev 缺省开
		const prompt = await buildDatabaseSchemaPrompt(io, {
			connectionEnv: { "prod-db": "prod", "dev-db": "dev" },
		});
		expect(prompt).toContain("连接「dev-db」");
		expect(prompt).not.toContain("prod-db");
	});

	it("dev 连接 connectionAiAccess[name]=false 时也被排除（显式优先于 env 缺省）", async () => {
		const io = makeIo({
			listConnections: vi.fn(async () => [{ name: "dev-db", env: "dev" as const }]),
			getSchemaContext: vi.fn(async () => "dev-db (id INTEGER)"),
		});
		// dev 缺省应该开，但显式 false 优先
		await expect(
			buildDatabaseSchemaPrompt(io, {
				connectionAiAccess: { "dev-db": false },
				connectionEnv: { "dev-db": "dev" },
			}),
		).resolves.toBeUndefined();
		expect(io.getSchemaContext).not.toHaveBeenCalled();
	});

	it("scope=tables 模式下 AI 白名单外的连接即使表在 scope 里也跳过", async () => {
		const io = makeIo({
			getTableSchemaContext: vi.fn(async (_connection: string, table: string) => `${table} (\n  id INTEGER\n)`),
		});
		const prompt = await buildDatabaseSchemaPrompt(io, {
			scope: {
				scope: "tables",
				connections: [],
				tables: [
					{ connection: "blocked-prod", table: "users" },
					{ connection: "allowed-dev", table: "orders" },
				],
			},
			connectionAiAccess: { "blocked-prod": false },
			connectionEnv: { "blocked-prod": "prod", "allowed-dev": "dev" },
		});
		expect(prompt).toContain("连接「allowed-dev」表「orders」");
		expect(prompt).not.toContain("blocked-prod");
		expect(prompt).not.toContain("users");
		// 只有 allowed-dev 的表被拉，blocked-prod 的被 AI 白名单直接跳过
		expect(io.getTableSchemaContext).toHaveBeenCalledTimes(1);
		expect(io.getTableSchemaContext).toHaveBeenCalledWith("allowed-dev", "orders");
	});

	it("scope=connections 模式与 AI 白名单交集生效", async () => {
		const io = makeIo({
			listConnections: vi.fn(async () => [
				{ name: "a", env: "dev" as const },
				{ name: "b", env: "dev" as const },
				{ name: "c", env: "prod" as const },
			]),
			getSchemaContext: vi.fn(async (name: string) => `${name} (id INTEGER)`),
		});
		// scope.connections 允许 a + b + c，但 AI 白名单只开 a + b（显式）+ prod c 缺省关
		const prompt = await buildDatabaseSchemaPrompt(io, {
			scope: { scope: "connections", connections: ["a", "b", "c"], tables: [] },
			connectionAiAccess: { a: true, b: true },
			connectionEnv: { a: "dev", b: "dev", c: "prod" },
		});
		expect(prompt).toContain("连接「a」");
		expect(prompt).toContain("连接「b」");
		expect(prompt).not.toContain("连接「c」");
	});
});

describe("firstTableName", () => {
	it("从 schema 文本解析首个表名", () => {
		expect(firstTableName("users (\n  id INTEGER\n)")).toBe("users");
		expect(firstTableName("users (id INTEGER PK, name TEXT)\ndepartments (id INTEGER)")).toBe("users");
	});
	it("无表名时返回 undefined", () => {
		expect(firstTableName("（schema 为空）")).toBeUndefined();
		expect(firstTableName("")).toBeUndefined();
	});
});

describe("buildSqlExamples", () => {
	it("生成基于真实表名的只读 SELECT 示例", () => {
		const examples = buildSqlExamples("users");
		expect(examples).toContain('SELECT * FROM "users" LIMIT 100;');
		expect(examples).toContain('SELECT COUNT(*) AS total FROM "users";');
	});
	it("表名内嵌引号被转义", () => {
		expect(buildSqlExamples('we"ird')).toContain('FROM "we""ird"');
	});
});

describe("renderSchemaContextBlock few-shot", () => {
	it("表级条目注入参考示例节", () => {
		const prompt = renderSchemaContextBlock([
			{ connectionName: "a", tableName: "users", schema: "users (\n  id INTEGER\n)" },
		]);
		expect(prompt).toContain("## 参考 SQL 示例");
		expect(prompt).toContain('SELECT * FROM "users" LIMIT 100;');
	});
	it("连接级条目从 schema 文本解析表名注入示例", () => {
		const prompt = renderSchemaContextBlock([
			{ connectionName: "a", schema: "users (id INTEGER)\ndepartments (id INTEGER)" },
		]);
		expect(prompt).toContain("## 参考 SQL 示例");
		expect(prompt).toContain('SELECT * FROM "users" LIMIT 100;');
	});
	it("无可用表名时不注入示例节", () => {
		const prompt = renderSchemaContextBlock([{ connectionName: "a", schema: "（schema 摘要不可用）" }]);
		expect(prompt).not.toContain("## 参考 SQL 示例");
	});
});
