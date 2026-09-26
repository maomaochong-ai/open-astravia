import { describe, expect, test } from "vitest";
import { pushQueryHistory, QUERY_HISTORY_LIMIT, type QueryHistoryEntry, removeQueryHistory } from "./query-history";

function entry(id: string, connection: string, sql: string, at: number): QueryHistoryEntry {
	return { id, connection, sql, at };
}

describe("pushQueryHistory", () => {
	test("prepends a new entry and trims whitespace", () => {
		const result = pushQueryHistory([], "conn-a", "  SELECT 1  ", 1000);
		expect(result).toHaveLength(1);
		expect(result[0]?.connection).toBe("conn-a");
		expect(result[0]?.sql).toBe("SELECT 1");
		expect(result[0]?.at).toBe(1000);
	});

	test("returns a copy when sql is blank", () => {
		const base = [entry("1", "conn-a", "SELECT 1", 1000)];
		expect(pushQueryHistory(base, "conn-a", "   ", 2000)).toEqual(base);
		expect(pushQueryHistory(base, "conn-a", "   ")).not.toBe(base);
	});

	test("deduplicates by connection + sql and moves to top", () => {
		const base = [entry("old", "conn-a", "SELECT 1", 1000), entry("keep", "conn-b", "SELECT 2", 900)];
		const result = pushQueryHistory(base, "conn-a", "SELECT 1", 2000);
		expect(result).toHaveLength(2);
		expect(result[0]?.id).not.toBe("old");
		expect(result[0]?.sql).toBe("SELECT 1");
		expect(result[0]?.at).toBe(2000);
		expect(result[1]?.id).toBe("keep");
	});

	test("keeps newest N entries", () => {
		let entries: QueryHistoryEntry[] = [];
		for (let i = 0; i < QUERY_HISTORY_LIMIT + 10; i++) {
			entries = pushQueryHistory(entries, `conn-${i % 3}`, `SELECT ${i}`, i);
		}
		expect(entries).toHaveLength(QUERY_HISTORY_LIMIT);
		expect(entries[0]?.sql).toBe(`SELECT ${QUERY_HISTORY_LIMIT + 9}`);
	});

	test("does not mutate the input array", () => {
		const base = [entry("1", "conn-a", "SELECT 1", 1000)];
		const snapshot = [...base];
		pushQueryHistory(base, "conn-b", "SELECT 2", 2000);
		expect(base).toEqual(snapshot);
	});
});

describe("removeQueryHistory", () => {
	test("removes the matching id and returns a new array", () => {
		const base = [entry("a", "conn-a", "SELECT 1", 1000), entry("b", "conn-b", "SELECT 2", 900)];
		const result = removeQueryHistory(base, "a");
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("b");
		expect(result).not.toBe(base);
	});

	test("returns the ORIGINAL reference when id is not found — avoids unnecessary localStorage writes (Bug 2 回归)", () => {
		const base = [entry("a", "conn-a", "SELECT 1", 1000)];
		const result = removeQueryHistory(base, "missing");
		expect(result).toBe(base);
	});
});
