import { describe, expect, it } from "vitest";
import { catalogIntrospectionSql, extractCatalogNames, filterCatalogNames } from "./database-catalog.js";

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
