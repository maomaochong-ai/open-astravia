import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	filterScopesByVisibility,
	filterTablesByVisibility,
	isNameVisible,
	loadExplorerVisibility,
	saveExplorerVisibility,
} from "./explorer-visibility";

function createMemStorage(): Storage {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
		clear: () => void store.clear(),
		key: (index: number) => [...store.keys()][index] ?? null,
		get length() {
			return store.size;
		},
	} as Storage;
}

describe("isNameVisible", () => {
	it("无规则时全部可见", () => {
		expect(isNameVisible("orders")).toBe(true);
		expect(isNameVisible("orders", undefined)).toBe(true);
	});

	it("include 空 = 不限；命中任一 glob 可见", () => {
		expect(isNameVisible("orders", { include: [], exclude: [] })).toBe(true);
		expect(isNameVisible("order_items", { include: ["order*"], exclude: [] })).toBe(true);
		expect(isNameVisible("users", { include: ["order*"], exclude: [] })).toBe(false);
	});

	it("exclude 命中即隐藏，优先于 include", () => {
		const patterns = { include: ["*_archive", "orders"], exclude: ["*_archive"] };
		expect(isNameVisible("orders", patterns)).toBe(true);
		expect(isNameVisible("orders_archive", patterns)).toBe(false);
	});

	it("大小写不敏感、? 匹配单字符", () => {
		expect(isNameVisible("ORDERS", { include: ["orders"], exclude: [] })).toBe(true);
		expect(isNameVisible("t1", { include: ["t?"], exclude: [] })).toBe(true);
		expect(isNameVisible("tab", { include: ["t?"], exclude: [] })).toBe(false);
	});
});

describe("filterScopesByVisibility / filterTablesByVisibility", () => {
	const items = [
		{ name: "public", kind: "schema" },
		{ name: "audit", kind: "schema" },
	] as const;

	it("未配置时返回原数组引用", () => {
		expect(filterScopesByVisibility(items, undefined)).toBe(items);
		expect(filterTablesByVisibility(items, undefined)).toBe(items);
	});

	it("按 include/exclude 过滤但保留剩余顺序", () => {
		expect(filterScopesByVisibility(items, { include: ["pub*"], exclude: [] })).toEqual([
			{ name: "public", kind: "schema" },
		]);
		expect(filterTablesByVisibility(items, { include: [], exclude: ["public"] })).toEqual([
			{ name: "audit", kind: "schema" },
		]);
	});
});

describe("load/saveExplorerVisibility", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", createMemStorage());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("空存储 → 空 map；损坏 JSON → 空 map", () => {
		expect(loadExplorerVisibility()).toEqual({});
		globalThis.localStorage.setItem("astravia.db.explorer.v1.visibility", "nope");
		expect(loadExplorerVisibility()).toEqual({});
	});

	it("保存后原样读回；空配置连接被剔除", () => {
		saveExplorerVisibility({
			pg1: {
				scopes: { include: ["public", "sales*"], exclude: ["audit"] },
				tables: { include: [], exclude: ["*_internal"] },
			},
			pg2: { tables: { include: ["orders"], exclude: [] } },
			pg3: {},
		});
		expect(loadExplorerVisibility()).toEqual({
			pg1: {
				scopes: { include: ["public", "sales*"], exclude: ["audit"] },
				tables: { include: [], exclude: ["*_internal"] },
			},
			pg2: { tables: { include: ["orders"], exclude: [] } },
		});
	});

	it("结构不符的连接被跳过，其余保留", () => {
		globalThis.localStorage.setItem(
			"astravia.db.explorer.v1.visibility",
			JSON.stringify({
				ok: { scopes: { exclude: ["x"] } },
				bad1: { scopes: { include: 42 } },
				bad2: "str",
				bad3: { tables: { include: 42, exclude: "x" } },
			}),
		);
		expect(loadExplorerVisibility()).toEqual({
			ok: { scopes: { include: [], exclude: ["x"] } },
		});
	});
});
