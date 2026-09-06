import { describe, expect, it } from "vitest";
import type { DbColumnInfo } from "../../../../preload/api-types/database";
import { formatAnchorTableSchema, type TableAnchor } from "./ai-anchor";

function column(partial: Partial<DbColumnInfo>): DbColumnInfo {
	return {
		name: "c",
		type: "varchar",
		nullable: true,
		hasDefault: false,
		defaultValue: "",
		comment: "",
		isPrimaryKey: false,
		...partial,
	};
}

const pgTable: TableAnchor = {
	source: "table",
	connectionName: "pg-main",
	table: "orders",
	scope: { schema: "public", database: "app" },
};
const flatTable: TableAnchor = { source: "table", connectionName: "sqlite-a", table: "orders", scope: null };

describe("ai-anchor (P0 打开表锚点)", () => {
	describe("formatAnchorTableSchema", () => {
		it("renders column name/type with PK, NOT NULL, DEFAULT and comment flags", () => {
			const text = formatAnchorTableSchema(pgTable, [
				column({ name: "id", type: "bigint", nullable: false, isPrimaryKey: true }),
				column({ name: "customer_name", type: "varchar", nullable: false, comment: "客户名称" }),
				column({ name: "amount", type: "numeric(10,2)", hasDefault: true, defaultValue: "0" }),
			]);
			expect(text).toContain("public.orders (");
			expect(text).toContain("  id bigint PRIMARY KEY NOT NULL");
			expect(text).toContain("  customer_name varchar NOT NULL -- 客户名称");
			expect(text).toContain("  amount numeric(10,2) DEFAULT 0");
		});

		it("qualifies with database scope when no schema (MySQL-style)", () => {
			const anchor: TableAnchor = {
				source: "table",
				connectionName: "mysql-a",
				table: "users",
				scope: { database: "app" },
			};
			expect(formatAnchorTableSchema(anchor, [])).toContain("app.users (");
		});

		it("keeps bare table name when scope is null (flat connection)", () => {
			expect(formatAnchorTableSchema(flatTable, [])).toContain("orders (");
		});

		it("falls back to unknown type and stays balanced for empty columns", () => {
			const text = formatAnchorTableSchema(flatTable, [column({ name: "x", type: "" })]);
			expect(text).toContain("  x unknown");
			expect(text.endsWith("\n)")).toBe(true);
		});
	});
});
