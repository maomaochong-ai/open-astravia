import { describe, expect, it } from "vitest";
import type { DbConnection, DbTableInfo } from "../../../../preload/api-types/database.js";
import {
	connectionGroupOf,
	connectionMatchesQuery,
	filterConnections,
	filterKindSections,
	filterTables,
	groupConnections,
	qualifiedTableName,
	sortConnectionsByName,
	splitTableKindSections,
	tableKindOf,
	tableMatchesQuery,
} from "./database-tree.js";

const DEFAULT = "默认分组";

function conn(name: string, groupPath = ""): DbConnection {
	return { id: name, name, groupPath, type: "postgres", host: "h", port: 5432, database: "d", env: "dev" };
}

function table(name: string): DbTableInfo {
	return { name, kind: "BASE TABLE" };
}

describe("connectionGroupOf", () => {
	it("空 groupPath 归默认分组", () => {
		expect(connectionGroupOf(conn("a"), DEFAULT)).toBe(DEFAULT);
	});

	it("取路径首段（/ 与 \\ 都支持）", () => {
		expect(connectionGroupOf(conn("a", "生产/订单库"), DEFAULT)).toBe("生产");
		expect(connectionGroupOf(conn("b", "生产\\订单库"), DEFAULT)).toBe("生产");
		expect(connectionGroupOf(conn("c", "测试"), DEFAULT)).toBe("测试");
	});

	it("纯空白 groupPath 归默认", () => {
		expect(connectionGroupOf(conn("a", "   "), DEFAULT)).toBe(DEFAULT);
	});
});

describe("groupConnections", () => {
	it("保持连接原始顺序，组名排序（默认分组置顶）", () => {
		const a = conn("a", "生产");
		const b = conn("b");
		const c = conn("c", "测试");
		const groups = groupConnections([a, b, c], DEFAULT);
		expect(groups.map((g) => g.group)).toEqual([DEFAULT, "测试", "生产"]);
		expect(groups.find((g) => g.group === DEFAULT)?.connections).toEqual([b]);
		expect(groups.find((g) => g.group === "生产")?.connections).toEqual([a]);
	});

	it("空列表返回空数组", () => {
		expect(groupConnections([], DEFAULT)).toEqual([]);
	});

	it("同一组内保持传入顺序", () => {
		const a = conn("a", "生产");
		const b = conn("b", "生产");
		expect(groupConnections([a, b], DEFAULT)[0].connections).toEqual([a, b]);
	});
});

describe("搜索匹配", () => {
	it("连接名不区分大小写匹配", () => {
		expect(connectionMatchesQuery(conn("MyDB"), "mydb")).toBe(true);
		expect(connectionMatchesQuery(conn("MyDB"), "db")).toBe(true);
		expect(connectionMatchesQuery(conn("MyDB"), "nope")).toBe(false);
	});

	it("表名不区分大小写匹配", () => {
		expect(tableMatchesQuery(table("Users"), "users")).toBe(true);
		expect(tableMatchesQuery(table("Users"), "ser")).toBe(true);
		expect(tableMatchesQuery(table("Users"), "orders")).toBe(false);
	});

	it("filterTables 空查询返回全部（拷贝）", () => {
		const tables = [table("users"), table("orders")];
		const result = filterTables(tables, "  ");
		expect(result).toEqual(tables);
		expect(result).not.toBe(tables);
	});

	it("filterTables 只保留表名命中的表", () => {
		const tables = [table("users"), table("order_items"), table("products")];
		expect(filterTables(tables, "order").map((item) => item.name)).toEqual(["order_items"]);
		expect(filterTables(tables, "USERS").map((item) => item.name)).toEqual(["users"]);
		expect(filterTables(tables, "nope")).toEqual([]);
	});
});

describe("filterConnections", () => {
	const users = table("users");
	const orders = table("orders");
	const connections = [conn("生产库"), conn("测试库")];

	it("空查询返回全部且不强制展开", () => {
		const result = filterConnections(connections, "  ", () => []);
		expect(result.visible).toEqual(connections);
		expect(result.forceExpanded.size).toBe(0);
	});

	it("连接名命中则保留（无需表数据）", () => {
		const result = filterConnections(connections, "生产", () => []);
		expect(result.visible.map((c) => c.name)).toEqual(["生产库"]);
		expect(result.forceExpanded.size).toBe(0);
	});

	it("表名命中保留连接并强制展开", () => {
		const tableNamesOf = (c: DbConnection) => (c.name === "测试库" ? [users, orders] : [users]);
		const result = filterConnections(connections, "orders", tableNamesOf);
		expect(result.visible.map((c) => c.name)).toEqual(["测试库"]);
		expect(result.forceExpanded.has("测试库")).toBe(true);
	});

	it("scope 名（PG schema / MySQL database）命中保留连接并强制展开", () => {
		const connections = [conn("生产库"), conn("测试库")];
		const scopeNamesOf = (c: DbConnection) => (c.name === "测试库" ? ["analytics", "public"] : ["public"]);
		const result = filterConnections(connections, "analytics", () => [], scopeNamesOf);
		expect(result.visible.map((c) => c.name)).toEqual(["测试库"]);
		expect(result.forceExpanded.has("测试库")).toBe(true);
	});
	it("scope 名大小写不敏感", () => {
		const connections = [conn("生产库")];
		const scopeNamesOf = () => ["Analytics"];
		const result = filterConnections(connections, "analytics", () => [], scopeNamesOf);
		expect(result.visible.map((c) => c.name)).toEqual(["生产库"]);
		expect(result.forceExpanded.has("生产库")).toBe(true);
	});
	it("连接名未命中且 scope/表均未命中时不保留", () => {
		const connections = [conn("生产库")];
		const result = filterConnections(
			connections,
			"nope",
			() => [],
			() => ["public"],
		);
		expect(result.visible).toEqual([]);
	});
	it("无命中返回空", () => {
		const result = filterConnections(connections, "不存在", () => [users, orders]);
		expect(result.visible).toEqual([]);
		expect(result.forceExpanded.size).toBe(0);
	});
});

describe("表对象类型分区", () => {
	it("含 view 的 kind 归 views，其余归 tables", () => {
		expect(tableKindOf("BASE TABLE")).toBe("tables");
		expect(tableKindOf("VIEW")).toBe("views");
		expect(tableKindOf("SYSTEM VIEW")).toBe("views");
		expect(tableKindOf("MATERIALIZED VIEW")).toBe("views");
	});

	it("splitTableKindSections 分区且剔除空分区", () => {
		const items = [
			{ name: "orders", kind: "BASE TABLE" },
			{ name: "v_orders", kind: "VIEW" },
			{ name: "sys_tab", kind: "SYSTEM VIEW" },
		];
		expect(
			splitTableKindSections(items).map((section) => [section.kind, section.items.map((item) => item.name)]),
		).toEqual([
			["tables", ["orders"]],
			["views", ["v_orders", "sys_tab"]],
		]);
		expect(splitTableKindSections([{ name: "a", kind: "VIEW" }]).map((section) => section.kind)).toEqual(["views"]);
		expect(splitTableKindSections([])).toEqual([]);
	});
});

describe("sortConnectionsByName", () => {
	it("default 保持原数组引用与顺序", () => {
		const list = [conn("b"), conn("a")];
		expect(sortConnectionsByName(list, "default")).toBe(list);
	});

	it("asc / desc 按名称排序（数字感知）", () => {
		const list = [conn("beta"), conn("Alpha"), conn("alpha10"), conn("alpha2")];
		expect(sortConnectionsByName(list, "asc").map((c) => c.name)).toEqual(["Alpha", "alpha2", "alpha10", "beta"]);
		expect(sortConnectionsByName(list, "desc").map((c) => c.name)).toEqual(["beta", "alpha10", "alpha2", "Alpha"]);
	});

	it("不修改原数组", () => {
		const list = [conn("b"), conn("a")];
		const copy = [...list];
		sortConnectionsByName(list, "asc");
		expect(list).toEqual(copy);
	});
});

describe("filterKindSections", () => {
	const items = [
		{ name: "orders", kind: "BASE TABLE" },
		{ name: "v_orders", kind: "VIEW" },
	] as const;

	it("all 返回原分区", () => {
		const sections = splitTableKindSections([...items]);
		expect(filterKindSections(sections, "all")).toEqual(sections);
	});

	it("tables 仅保留表分区", () => {
		const sections = splitTableKindSections([...items]);
		expect(filterKindSections(sections, "tables").map((section) => section.kind)).toEqual(["tables"]);
	});

	it("views 仅保留视图分区且空分区剔除", () => {
		const sections = splitTableKindSections([{ name: "t", kind: "BASE TABLE" }]);
		expect(filterKindSections(sections, "views")).toEqual([]);
	});
});

describe("qualifiedTableName", () => {
	it("无 scope 返回原名", () => {
		expect(qualifiedTableName("orders")).toBe("orders");
		expect(qualifiedTableName("orders", null)).toBe("orders");
	});

	it("带 schema / database scope 拼接限定名", () => {
		expect(qualifiedTableName("orders", { kind: "schema", name: "analytics" })).toBe("analytics.orders");
		expect(qualifiedTableName("users", { kind: "database", name: "shop" })).toBe("shop.users");
	});
});
