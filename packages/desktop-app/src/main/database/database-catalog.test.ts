import { describe, expect, it } from "vitest";
import {
	catalogIntrospectionSql,
	extractCatalogNames,
	extractTableObjectNames,
	filterCatalogNames,
	tableObjectIntrospectionSql,
} from "./database-catalog.js";

describe("catalogIntrospectionSql", () => {
	it("schemas / databases 家族返回 information_schema 枚举 SQL", () => {
		const sql = catalogIntrospectionSql("schemas");
		expect(sql).toContain("information_schema.schemata");
		expect(catalogIntrospectionSql("databases")).toBe(sql);
	});

	it("flat（单库）连接无中间层，返回 null", () => {
		expect(catalogIntrospectionSql("flat")).toBeNull();
	});
});

describe("filterCatalogNames", () => {
	it("schemas：剔除系统 schema 与 pg_ 前缀对象，public 置顶", () => {
		const input = ["pg_toast", "auth", "information_schema", "public", "pg_catalog", "analytics", "pg_temp_1"];
		expect(filterCatalogNames("schemas", input)).toEqual(["public", "analytics", "auth"]);
	});

	it("schemas：无 public 时按字母序", () => {
		expect(filterCatalogNames("schemas", ["zebra", "alpha", "mid"])).toEqual(["alpha", "mid", "zebra"]);
	});

	it("databases：剔除系统库，按字母序", () => {
		const input = ["mysql", "app", "sys", "analytics", "information_schema", "performance_schema"];
		expect(filterCatalogNames("databases", input)).toEqual(["analytics", "app"]);
	});

	it("输入不受调用方污染", () => {
		const input = ["b", "public", "a"];
		const out = filterCatalogNames("schemas", input);
		expect(input).toEqual(["b", "public", "a"]);
		expect(out).toEqual(["public", "a", "b"]);
	});
});

describe("extractCatalogNames", () => {
	it("优先取 schema_name 列并 trim", () => {
		const names = extractCatalogNames(
			["schema_name", "x"],
			[
				{ schema_name: " public ", x: "ignored" },
				{ schema_name: "analytics", x: "ignored" },
			],
		);
		expect(names).toEqual(["public", "analytics"]);
	});

	it("无 schema_name 时取第一列兜底", () => {
		const names = extractCatalogNames(["name"], [{ name: "app_db" }]);
		expect(names).toEqual(["app_db"]);
	});

	it("跳过空值；空 columns 返回空数组", () => {
		expect(extractCatalogNames(["schema_name"], [{ schema_name: "" }, { schema_name: "  " }])).toEqual([]);
		expect(extractCatalogNames([], [])).toEqual([]);
	});
});

describe("tableObjectIntrospectionSql", () => {
	it("schemas：索引走 pg_indexes，约束/触发器走 information_schema", () => {
		const sql = tableObjectIntrospectionSql("schemas", "index", "orders", { schema: "public" });
		expect(sql).toContain("pg_indexes");
		expect(sql).toContain("schemaname = 'public'");
		expect(sql).toContain("tablename = 'orders'");
		expect(tableObjectIntrospectionSql("schemas", "constraint", "orders", { schema: "public" })).toContain(
			"information_schema.table_constraints",
		);
		expect(tableObjectIntrospectionSql("schemas", "trigger", "orders", { schema: "public" })).toContain(
			"information_schema.triggers",
		);
	});

	it("schemas：分区经 pg_inherits 递归取子表", () => {
		const sql = tableObjectIntrospectionSql("schemas", "partition", "orders", { schema: "public" });
		expect(sql).toContain("pg_inherits");
		expect(sql).toContain("parent.relname = 'orders'");
	});

	it("schemas：缺 schema 作用域返回 null", () => {
		expect(tableObjectIntrospectionSql("schemas", "index", "orders")).toBeNull();
		expect(tableObjectIntrospectionSql("schemas", "index", "orders", null)).toBeNull();
	});

	it("databases：索引/分区/约束/触发器走 MySQL information_schema", () => {
		expect(tableObjectIntrospectionSql("databases", "index", "t", { database: "app" })).toContain(
			"information_schema.statistics",
		);
		expect(tableObjectIntrospectionSql("databases", "partition", "t", { database: "app" })).toContain(
			"information_schema.partitions",
		);
		expect(tableObjectIntrospectionSql("databases", "constraint", "t", { database: "app" })).toContain(
			"information_schema.table_constraints",
		);
	});

	it("databases：缺 database 作用域返回 null", () => {
		expect(tableObjectIntrospectionSql("databases", "index", "t")).toBeNull();
	});

	it("flat（SQLite 等单库）不枚举，返回 null", () => {
		expect(tableObjectIntrospectionSql("flat", "index", "t", { schema: "main" })).toBeNull();
		expect(tableObjectIntrospectionSql("flat", "constraint", "t")).toBeNull();
	});

	it("单引号正确转义（防 SQL 注入）", () => {
		const sql = tableObjectIntrospectionSql("schemas", "index", "o'rder", { schema: "pub'lic" });
		expect(sql).toContain("'o''rder'");
		expect(sql).toContain("'pub''lic'");
	});
});

describe("extractTableObjectNames", () => {
	it("优先取 name 列并 trim", () => {
		const names = extractTableObjectNames(
			["name", "x"],
			[
				{ name: " idx_orders_created ", x: "ignored" },
				{ name: "orders_pkey", x: "ignored" },
			],
		);
		expect(names).toEqual(["idx_orders_created", "orders_pkey"]);
	});

	it("无 name 列取第一列兜底；跳过空值；空输入返回空数组", () => {
		expect(extractTableObjectNames(["object_name"], [{ object_name: "a" }])).toEqual(["a"]);
		expect(extractTableObjectNames(["name"], [{ name: "" }, { name: "  " }])).toEqual([]);
		expect(extractTableObjectNames([], [])).toEqual([]);
	});
});
