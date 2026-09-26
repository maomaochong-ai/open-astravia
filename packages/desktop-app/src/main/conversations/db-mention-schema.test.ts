import { describe, expect, it } from "vitest";
import {
	composeMentionedSchemaPromptSuffix,
	type DbMentionRef,
	extractDbMentions,
	formatMentionedTableSchema,
} from "./db-mention-schema.js";

const sampleColumns = [
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
		nullable: false,
		hasDefault: false,
		defaultValue: "",
		comment: "用户名",
		isPrimaryKey: false,
	},
	{
		name: "created_at",
		type: "TIMESTAMP",
		nullable: true,
		hasDefault: true,
		defaultValue: "now()",
		comment: "",
		isPrimaryKey: false,
	},
];

describe("extractDbMentions", () => {
	it("metadata 为 null / 非 object → 返回空数组", () => {
		expect(extractDbMentions(null)).toEqual([]);
		expect(extractDbMentions(undefined)).toEqual([]);
		expect(extractDbMentions("string")).toEqual([]);
	});

	it("databaseMentions 不是数组 → 返回空数组", () => {
		expect(extractDbMentions({ databaseMentions: null })).toEqual([]);
		expect(extractDbMentions({ databaseMentions: "conn.users" })).toEqual([]);
		expect(extractDbMentions({ databaseMentions: { conn: "users" } })).toEqual([]);
	});

	it("过滤非法条目：缺 connection / 缺 table / 空字符串 / 非 object", () => {
		const raw = [
			{ connection: "conn", table: "users" },
			{ connection: "", table: "users" }, // 空 connection
			{ connection: "conn", table: "" }, // 空 table
			{ connection: 123, table: "users" }, // 非 string
			null, // null entry
			"string", // string entry
			{ table: "users" }, // 缺 connection
			{ connection: "conn" }, // 缺 table
		];
		const result = extractDbMentions({ databaseMentions: raw });
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ connection: "conn", table: "users" });
	});

	it("scope 空串 → 降级为 undefined；非 string scope → 整条拒掉", () => {
		const raw = [
			{ connection: "c", table: "t", scope: "public" }, // 合法
			{ connection: "c", table: "t", scope: "" }, // 空串 → 保留，scope 降级 undefined
			{ connection: "c", table: "t", scope: 123 }, // 非 string → 整条拒绝
			{ connection: "c", table: "t" }, // 无 scope
		];
		const result = extractDbMentions({ databaseMentions: raw });
		expect(result).toEqual([
			{ connection: "c", table: "t", scope: "public" },
			{ connection: "c", table: "t" },
			{ connection: "c", table: "t" },
		]);
	});

	it("trim 空白", () => {
		const result = extractDbMentions({
			databaseMentions: [{ connection: "  prod  ", table: "  users  ", scope: "  public  " }],
		});
		expect(result).toEqual([{ connection: "prod", table: "users", scope: "public" }]);
	});

	it("多个合法条目全部保留", () => {
		const raw: DbMentionRef[] = [
			{ connection: "prod", table: "users" },
			{ connection: "staging", table: "orders", scope: "public" },
			{ connection: "dev", table: "sessions" },
		];
		const result = extractDbMentions({ databaseMentions: raw });
		expect(result).toHaveLength(3);
		expect(result[1]).toMatchObject({ connection: "staging", table: "orders", scope: "public" });
	});

	it("metadata 里压根没 databaseMentions key → 返回空", () => {
		expect(extractDbMentions({ foo: "bar" })).toEqual([]);
	});
});

describe("formatMentionedTableSchema", () => {
	it("不带 scope：表头格式 @conn.table", () => {
		const result = formatMentionedTableSchema("prod", "users", sampleColumns);
		expect(result).toContain("数据库表 @prod.users 的结构如下：");
		expect(result).not.toContain("（scope:");
	});

	it("带 scope：表头格式 @conn.scope.table 并附 scope: xxx 提示", () => {
		const result = formatMentionedTableSchema("prod", "users", sampleColumns, "public");
		expect(result).toContain("@prod.public.users");
		expect(result).toContain("scope: public");
	});

	it("PRIMARY KEY / NULLABLE / DEFAULT / COMMENT 正确标注", () => {
		const result = formatMentionedTableSchema("c", "t", sampleColumns);
		expect(result).toContain("- id: INTEGER PRIMARY KEY");
		expect(result).toContain("- name: TEXT");
		expect(result).toContain("-- 用户名");
		expect(result).toContain("- created_at: TIMESTAMP NULLABLE DEFAULT now()");
	});

	it("空列数组 → 只有表头", () => {
		const result = formatMentionedTableSchema("c", "t", []);
		expect(result).toBe("数据库表 @c.t 的结构如下：");
	});
});

describe("composeMentionedSchemaPromptSuffix", () => {
	it("单个 schema block → 末尾追加反循环指令", () => {
		const result = composeMentionedSchemaPromptSuffix(["数据库表 @c.t 的结构如下："]);
		expect(result).toContain("数据库表 @c.t 的结构如下：");
		expect(result).toContain("不要再调 dbx_describe_table");
		expect(result).toContain("只用 dbx_execute_query 跑 SELECT 查询");
	});

	it("多个 blocks 用空行分隔", () => {
		const result = composeMentionedSchemaPromptSuffix(["BLOCK1", "BLOCK2"]);
		expect(result).toContain("BLOCK1\n\nBLOCK2");
	});

	it("空数组 → 只有反循环指令", () => {
		const result = composeMentionedSchemaPromptSuffix([]);
		expect(result).toContain("不要再调 dbx_describe_table");
	});
});
