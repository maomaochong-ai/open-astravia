import { describe, expect, it } from "vitest";
import { dbTableMentionKey, formatDbTableMention, parseDbTableMentions } from "./parse.js";

describe("parseDbTableMentions", () => {
	// ─── 新格式（@db: 命名空间前缀，默认） ───
	it("新格式：@db:connection.table 基本格式", () => {
		const result = parseDbTableMentions("查询 @db:users-db.users 表");
		expect(result).toEqual([{ raw: "@db:users-db.users", connection: "users-db", table: "users" }]);
	});

	it("新格式：支持引号包裹连接名", () => {
		const result = parseDbTableMentions('分析 @db:"my conn".orders 表');
		expect(result).toEqual([{ raw: '@db:"my conn".orders', connection: "my conn", table: "orders" }]);
	});

	it("新格式：带 scope 的 3 段格式", () => {
		const result = parseDbTableMentions("查询 @db:conn.public.users");
		expect(result).toEqual([{ raw: "@db:conn.public.users", connection: "conn", scope: "public", table: "users" }]);
	});

	it("新格式：多个 mention 去重（大小写不敏感）", () => {
		const result = parseDbTableMentions("@db:DB.USERS 和 @db:db.users 和 @db:db.users");
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ connection: "DB", table: "USERS" });
	});

	it("新格式：多个不同 mention 都提取", () => {
		const result = parseDbTableMentions("@db:a.t1 和 @db:b.t2 还有 @db:c.t3");
		expect(result).toEqual([
			{ raw: "@db:a.t1", connection: "a", table: "t1" },
			{ raw: "@db:b.t2", connection: "b", table: "t2" },
			{ raw: "@db:c.t3", connection: "c", table: "t3" },
		]);
	});

	it("新格式：单部分 @db:word 不是数据库 mention（缺少 .table）", () => {
		const result = parseDbTableMentions("问问 @db:john 怎么回事");
		expect(result).toEqual([]);
	});

	it("新格式：@skill:xxx 不被误解析", () => {
		const result = parseDbTableMentions("用 @skill:api-doc 然后 @db:conn.users");
		expect(result).toEqual([{ raw: "@db:conn.users", connection: "conn", table: "users" }]);
	});

	it("新格式：与 @/path 共存不误解析", () => {
		const result = parseDbTableMentions("看一下 @/src/main.ts 然后查 @db:conn.users");
		expect(result).toEqual([{ raw: "@db:conn.users", connection: "conn", table: "users" }]);
	});

	it("新格式：a@b.com 不触发（@ 不是词首）", () => {
		const result = parseDbTableMentions("联系 a@b.com 或 @db:conn.users");
		expect(result).toEqual([{ raw: "@db:conn.users", connection: "conn", table: "users" }]);
	});

	it("新格式：验证列表过滤", () => {
		const result = parseDbTableMentions("@db:real.users 和 @db:fake.ghost", ["real"]);
		expect(result).toEqual([{ raw: "@db:real.users", connection: "real", table: "users" }]);
	});

	it("新格式：连接名带特殊字符", () => {
		const result = parseDbTableMentions("@db:my-db_v1.users_info$2");
		expect(result).toEqual([{ raw: "@db:my-db_v1.users_info$2", connection: "my-db_v1", table: "users_info$2" }]);
	});

	it("新格式：@db: 后直接不是 conn.table 格式则不匹配", () => {
		// @db:xxx 只有一段，缺少 .table → 不认
		expect(parseDbTableMentions("@db:xxx")).toEqual([]);
	});

	it("边界：四层点分 @db:a.b.c.d — 首段 connection，末两段 scope/table", () => {
		expect(parseDbTableMentions("@db:a.b.c.d")).toEqual([
			{ raw: "@db:a.b.c.d", connection: "a", scope: "c", table: "d" },
		]);
	});

	it("边界：双点 @db:a..b — 被正确拒绝（readMentionToken 不接受空段）", () => {
		expect(parseDbTableMentions("@db:a..b")).toEqual([]);
	});

	it("边界：@db:a@b.users — @ 前不是词首，不触发", () => {
		expect(parseDbTableMentions("@db:a@b.users")).toEqual([]);
	});

	it('新格式 3 段+引号：连接名含空格 @db:"my conn".public.users', () => {
		expect(parseDbTableMentions('@db:"my conn".public.users')).toEqual([
			{ raw: '@db:"my conn".public.users', connection: "my conn", scope: "public", table: "users" },
		]);
	});

	// ─── 旧格式兼容（无前缀，format: "legacy"） ───
	it("旧格式：无前缀 @conn.table 能被解析（format: legacy）", () => {
		const result = parseDbTableMentions("查 @conn.users", undefined, "legacy");
		expect(result).toEqual([{ raw: "@conn.users", connection: "conn", table: "users" }]);
	});

	it("旧格式：无前缀 @conn.schema.table 能被解析（format: legacy）", () => {
		const result = parseDbTableMentions("查 @conn.public.users", undefined, "legacy");
		expect(result).toEqual([{ raw: "@conn.public.users", connection: "conn", scope: "public", table: "users" }]);
	});

	it("默认新格式不识别旧格式 @conn.table（消除 @hello.world 歧义）", () => {
		// format 默认 "new"，无前缀的 @xxx.yyy 不被识别为 db-table
		const result = parseDbTableMentions("看下 @hello.world 这个词");
		expect(result).toEqual([]);
	});

	// ─── 通用边界 ───
	it("空文本返回空数组", () => {
		expect(parseDbTableMentions("")).toEqual([]);
	});

	it("无 @ 返回空数组", () => {
		expect(parseDbTableMentions("纯文本没有 mention")).toEqual([]);
	});

	it("@ 末尾无内容返回空数组", () => {
		expect(parseDbTableMentions("查一下 @")).toEqual([]);
	});
});

describe("formatDbTableMention", () => {
	it("简单格式不加引号，带 @db: 前缀", () => {
		expect(formatDbTableMention("conn", "users")).toBe("@db:conn.users");
	});

	it("连接名含空格加双引号", () => {
		expect(formatDbTableMention("my conn", "users")).toBe('@db:"my conn".users');
	});

	it("带 scope（3 段格式）", () => {
		expect(formatDbTableMention("conn", "users", "public")).toBe("@db:conn.public.users");
	});

	it("带 scope 且连接名含空格——round-trip 后 parse 能回来", () => {
		const formatted = formatDbTableMention("my conn", "users", "public");
		expect(formatted).toBe('@db:"my conn".public.users');
		const mentions = parseDbTableMentions(formatted);
		expect(mentions).toEqual([
			{ raw: '@db:"my conn".public.users', connection: "my conn", scope: "public", table: "users" },
		]);
	});

	it("table 含空格也加双引号", () => {
		expect(formatDbTableMention("conn", "user table")).toBe('@db:conn."user table"');
	});
});

describe("dbTableMentionKey", () => {
	it("小写化 connection.table（不带 scope 向后兼容）", () => {
		expect(dbTableMentionKey("MyConn", "Users")).toBe("myconn.users");
	});
	it("带 scope 时 scope 参与 key——同一 connection.table 不同 scope 是不同实体", () => {
		expect(dbTableMentionKey("db", "users", "public")).toBe("db.public.users");
		expect(dbTableMentionKey("db", "users", "staging")).toBe("db.staging.users");
		expect(dbTableMentionKey("db", "users", "public")).not.toBe(dbTableMentionKey("db", "users", "staging"));
	});
});
