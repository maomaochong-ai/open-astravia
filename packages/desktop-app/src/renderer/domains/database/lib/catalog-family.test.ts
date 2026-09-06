import { describe, expect, it } from "vitest";
import { catalogFamilyOfType, isUsableScope, scopeToTableScope, tableScopeQualifier } from "./catalog-family.js";

describe("catalogFamilyOfType", () => {
	it("PG 系驱动归为 schemas", () => {
		for (const type of ["postgres", "pg", "pgsql", "redshift", "cockroachdb", "cockroach", "edb"]) {
			expect(catalogFamilyOfType(type)).toBe("schemas");
		}
	});

	it("大小写不敏感", () => {
		expect(catalogFamilyOfType("PostgreSQL")).toBe("schemas");
		expect(catalogFamilyOfType("MySQL")).toBe("databases");
	});

	it("MySQL 系驱动归为 databases", () => {
		for (const type of ["mysql", "mariadb", "tidb", "doris", "starrocks", "oceanbase-mysql", "mysql2"]) {
			expect(catalogFamilyOfType(type)).toBe("databases");
		}
	});

	it("单库 / 未知驱动归为 flat", () => {
		for (const type of ["sqlite", "sqlserver", "mssql", "oracle", "duckdb", "clickhouse", "", "UNKNOWN"]) {
			expect(catalogFamilyOfType(type)).toBe("flat");
		}
	});
});

describe("isUsableScope", () => {
	it("空名 / 纯空白作用域不可用", () => {
		expect(isUsableScope({ kind: "schema", name: "" })).toBe(false);
		expect(isUsableScope({ kind: "database", name: "   " })).toBe(false);
	});

	it("正常作用域可用", () => {
		expect(isUsableScope({ kind: "schema", name: "public" })).toBe(true);
		expect(isUsableScope({ kind: "database", name: "app_db" })).toBe(true);
	});
});

describe("scopeToTableScope", () => {
	it("schema 作用域 → { schema }", () => {
		expect(scopeToTableScope({ kind: "schema", name: "public" })).toEqual({ schema: "public" });
	});

	it("database 作用域 → { database }", () => {
		expect(scopeToTableScope({ kind: "database", name: "app" })).toEqual({ database: "app" });
	});
});

describe("tableScopeQualifier", () => {
	it("无作用域 → undefined", () => {
		expect(tableScopeQualifier(null)).toBeUndefined();
		expect(tableScopeQualifier(undefined)).toBeUndefined();
		expect(tableScopeQualifier({})).toBeUndefined();
	});

	it("schema 优先于 database", () => {
		expect(tableScopeQualifier({ schema: "public", database: "app" })).toBe("public");
	});

	it("database 兜底", () => {
		expect(tableScopeQualifier({ database: "app" })).toBe("app");
	});
});
