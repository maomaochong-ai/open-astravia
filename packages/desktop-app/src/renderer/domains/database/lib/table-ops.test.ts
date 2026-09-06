import { describe, expect, it } from "vitest";
import { buildDangerOpSql, buildExportSelectSql, exportFileName, type TableTarget, toCsv, toJson } from "./table-ops";

const pg: TableTarget = { dbType: "postgres", table: "orders" };
const pgSchema: TableTarget = { dbType: "postgres", table: "orders", schema: "sales" };
const mySql: TableTarget = { dbType: "mysql", table: "order items" };
const sqlServer: TableTarget = { dbType: "sqlserver", table: "orders" };

describe("buildExportSelectSql", () => {
	it("无 schema：裸表名 + LIMIT", () => {
		expect(buildExportSelectSql(pg, 100)).toBe('SELECT * FROM "orders" LIMIT 100');
	});
	it("带 schema：限定引用", () => {
		expect(buildExportSelectSql(pgSchema, 50)).toBe('SELECT * FROM "sales"."orders" LIMIT 50');
	});
	it("MySQL 反引号 + 含空格表名", () => {
		expect(buildExportSelectSql(mySql, 10)).toBe("SELECT * FROM `order items` LIMIT 10");
	});
});

describe("buildDangerOpSql", () => {
	it("TRUNCATE 方言无关", () => {
		expect(buildDangerOpSql(pg, "truncate")).toBe('TRUNCATE TABLE "orders"');
		expect(buildDangerOpSql(pgSchema, "truncate")).toBe('TRUNCATE TABLE "sales"."orders"');
	});
	it("DROP 带 schema 限定", () => {
		expect(buildDangerOpSql(pgSchema, "drop")).toBe('DROP TABLE "sales"."orders"');
	});
	it("RENAME：ALTER TABLE RENAME TO（PG/MySQL/SQLite 族）", () => {
		expect(buildDangerOpSql(pg, "rename", "orders_archive")).toBe('ALTER TABLE "orders" RENAME TO "orders_archive"');
		expect(buildDangerOpSql(mySql, "rename", "order items v2")).toBe(
			"ALTER TABLE `order items` RENAME TO `order items v2`",
		);
	});
	it("RENAME：SQL Server 走 sp_rename", () => {
		expect(buildDangerOpSql(sqlServer, "rename", "orders_archive")).toBe("EXEC sp_rename 'orders', 'orders_archive'");
	});
	it("RENAME 缺新名抛错", () => {
		expect(() => buildDangerOpSql(pg, "rename")).toThrow("new table name");
	});
});

describe("toCsv", () => {
	it("基本行 + 首行列头", () => {
		const csv = toCsv({
			columns: ["id", "name"],
			rows: [
				{ id: "1", name: "Alice" },
				{ id: "2", name: null },
			],
		});
		expect(csv).toBe("id,name\r\n1,Alice\r\n2,\r\n");
	});
	it("含逗号/引号/换行的单元格转义", () => {
		const csv = toCsv({
			columns: ["note"],
			rows: [{ note: 'he said "hi", ok' }, { note: "line1\nline2" }],
		});
		expect(csv).toBe('note\r\n"he said ""hi"", ok"\r\n"line1\nline2"\r\n');
	});
});

describe("toJson", () => {
	it("输出带列定义的稳定结构", () => {
		const json = toJson({ columns: ["id"], rows: [{ id: "7" }] });
		expect(JSON.parse(json)).toEqual({ columns: ["id"], rows: [{ id: "7" }] });
	});
});

describe("exportFileName", () => {
	it("表名 + 日期 + 扩展名", () => {
		const name = exportFileName("orders", "csv");
		expect(name).toMatch(/^orders_\d{4}-\d{2}-\d{2}\.csv$/);
	});
});
