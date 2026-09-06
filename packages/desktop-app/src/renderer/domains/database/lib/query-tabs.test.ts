import { describe, expect, test } from "vitest";
import { closeQueryTab, createQueryTab, patchQueryTab, type QueryTabState, reorderQueryTabs } from "./query-tabs";

function make(id: string, title = id): QueryTabState {
	return createQueryTab(id, title);
}

const FALLBACK = { id: "fallback", title: "查询 9" };

describe("createQueryTab", () => {
	test("creates an empty idle tab with defaults", () => {
		const tab = make("t1", "查询 1");
		expect(tab.id).toBe("t1");
		expect(tab.title).toBe("查询 1");
		expect(tab.sql).toBe("");
		expect(tab.status).toBe("idle");
		expect(tab.result).toBeNull();
		expect(tab.resultConnectionName).toBeNull();
		expect(tab.resultSql).toBeNull();
		expect(tab.error).toBeNull();
		expect(tab.errorDetail).toBeNull();
		expect(tab.openTableMeta).toBeNull();
		expect(tab.loadingPage).toBe(false);
	});

	test("applies initial overrides (open table flow)", () => {
		const tab = createQueryTab("t2", "users", {
			sql: "SELECT * FROM users LIMIT 100",
			openTableMeta: { type: "postgres", connectionName: "t2", table: "users", pageSize: 100, page: 1, scope: null },
		});
		expect(tab.sql).toBe("SELECT * FROM users LIMIT 100");
		expect(tab.openTableMeta).toEqual({
			type: "postgres",
			connectionName: "t2",
			table: "users",
			pageSize: 100,
			page: 1,
			scope: null,
		});
		expect(tab.status).toBe("idle");
	});
});

describe("closeQueryTab", () => {
	test("removes the target tab and keeps order", () => {
		const tabs = [make("a"), make("b"), make("c")];
		const next = closeQueryTab(tabs, "b", FALLBACK);
		expect(next.map((tab) => tab.id)).toEqual(["a", "c"]);
	});

	test("unknown id returns a copy without changes", () => {
		const tabs = [make("a")];
		const next = closeQueryTab(tabs, "nope", FALLBACK);
		expect(next).toEqual(tabs);
		expect(next).not.toBe(tabs);
	});

	test("closing the last tab replaces it with a fresh empty tab (never zero tabs)", () => {
		const tabs = [make("only")];
		const next = closeQueryTab(tabs, "only", FALLBACK);
		expect(next).toHaveLength(1);
		expect(next[0]?.id).toBe("fallback");
		expect(next[0]?.title).toBe("查询 9");
		expect(next[0]?.sql).toBe("");
		expect(next[0]?.status).toBe("idle");
	});

	test("does not mutate the input array", () => {
		const tabs = [make("a"), make("b")];
		const snapshot = [...tabs];
		closeQueryTab(tabs, "a", FALLBACK);
		expect(tabs).toEqual(snapshot);
	});
});

describe("reorderQueryTabs", () => {
	test("reorders per the given ids", () => {
		const tabs = [make("a"), make("b"), make("c")];
		const next = reorderQueryTabs(tabs, ["c", "a", "b"]);
		expect(next.map((tab) => tab.id)).toEqual(["c", "a", "b"]);
	});

	test("ignores unknown ids and appends missing tabs stably at the end", () => {
		const tabs = [make("a"), make("b"), make("c")];
		const next = reorderQueryTabs(tabs, ["c", "unknown", "b"]);
		expect(next.map((tab) => tab.id)).toEqual(["c", "b", "a"]);
	});

	test("does not mutate the input array", () => {
		const tabs = [make("a"), make("b")];
		const snapshot = [...tabs];
		reorderQueryTabs(tabs, ["b", "a"]);
		expect(tabs).toEqual(snapshot);
	});
});

describe("patchQueryTab", () => {
	test("patches only the target tab and leaves others untouched", () => {
		const tabs = [make("a"), make("b")];
		const next = patchQueryTab(tabs, "b", { sql: "SELECT 1", status: "success", error: null });
		expect(next[0]).toEqual(tabs[0]);
		expect(next[1]?.sql).toBe("SELECT 1");
		expect(next[1]?.status).toBe("success");
		expect(next[1]?.id).toBe("b");
		expect(next[1]).not.toBe(tabs[1]);
	});

	test("unknown id returns a copy without changes", () => {
		const tabs = [make("a")];
		const next = patchQueryTab(tabs, "nope", { sql: "SELECT 1" });
		expect(next).toEqual(tabs);
		expect(next).not.toBe(tabs);
	});

	test("does not mutate the input array", () => {
		const tabs = [make("a")];
		const snapshot = [...tabs];
		patchQueryTab(tabs, "a", { sql: "SELECT 2" });
		expect(tabs).toEqual(snapshot);
	});
});
