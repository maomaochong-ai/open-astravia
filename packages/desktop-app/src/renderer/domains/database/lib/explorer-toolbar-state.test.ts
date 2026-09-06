import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_EXPLORER_TOOLBAR_STATE,
	loadExplorerToolbarState,
	parseExplorerToolbarState,
	saveExplorerToolbarState,
} from "./explorer-toolbar-state";

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

describe("parseExplorerToolbarState", () => {
	it("空/非法输入回落默认值", () => {
		expect(parseExplorerToolbarState(null)).toEqual(DEFAULT_EXPLORER_TOOLBAR_STATE);
		expect(parseExplorerToolbarState("")).toEqual(DEFAULT_EXPLORER_TOOLBAR_STATE);
		expect(parseExplorerToolbarState("not-json")).toEqual(DEFAULT_EXPLORER_TOOLBAR_STATE);
		expect(parseExplorerToolbarState('"str"')).toEqual(DEFAULT_EXPLORER_TOOLBAR_STATE);
		expect(parseExplorerToolbarState("[1,2]")).toEqual(DEFAULT_EXPLORER_TOOLBAR_STATE);
	});

	it("合法快照原样读回（含 globalSearch）", () => {
		const raw = JSON.stringify({
			searchQuery: "orders",
			healthyOnly: true,
			globalSearch: false,
			sortOrder: "asc",
			kindFilter: "views",
		});
		expect(parseExplorerToolbarState(raw)).toEqual({
			searchQuery: "orders",
			healthyOnly: true,
			globalSearch: false,
			sortOrder: "asc",
			kindFilter: "views",
		});
	});

	it("旧版快照缺 globalSearch 字段时默认开启（保持既有跨连接搜索体验）", () => {
		const raw = JSON.stringify({
			searchQuery: "orders",
			healthyOnly: true,
			sortOrder: "asc",
			kindFilter: "views",
		});
		expect(parseExplorerToolbarState(raw).globalSearch).toBe(true);
	});

	it("字段级校验：损坏字段逐个回落默认值", () => {
		const raw = JSON.stringify({
			searchQuery: 42,
			healthyOnly: "yes",
			sortOrder: "sideways",
			kindFilter: "materialized",
		});
		expect(parseExplorerToolbarState(raw)).toEqual(DEFAULT_EXPLORER_TOOLBAR_STATE);
	});

	it("部分字段缺失时仅补缺省", () => {
		const raw = JSON.stringify({ searchQuery: "acc" });
		expect(parseExplorerToolbarState(raw)).toEqual({
			...DEFAULT_EXPLORER_TOOLBAR_STATE,
			searchQuery: "acc",
		});
	});

	it("globalSearch 显式 false 时尊重关闭", () => {
		const raw = JSON.stringify({ searchQuery: "acc", globalSearch: false });
		expect(parseExplorerToolbarState(raw).globalSearch).toBe(false);
	});
});

describe("loadExplorerToolbarState / saveExplorerToolbarState", () => {
	const memStorage = createMemStorage();
	beforeEach(() => {
		memStorage.clear();
		vi.stubGlobal("window", { localStorage: memStorage });
	});
	afterEach(() => vi.unstubAllGlobals());

	it("无快照返回默认值", () => {
		expect(loadExplorerToolbarState()).toEqual(DEFAULT_EXPLORER_TOOLBAR_STATE);
	});

	it("save 后可 roundtrip 读回（含 globalSearch）", () => {
		const state = {
			searchQuery: "customer",
			healthyOnly: true,
			globalSearch: false,
			sortOrder: "desc" as const,
			kindFilter: "tables" as const,
		};
		saveExplorerToolbarState(state);
		expect(loadExplorerToolbarState()).toEqual(state);
	});

	it("存储不可用(读写抛错)时静默回落默认值", () => {
		vi.stubGlobal("window", {
			localStorage: {
				getItem: () => {
					throw new Error("denied");
				},
				setItem: () => {
					throw new Error("denied");
				},
			},
		});
		expect(loadExplorerToolbarState()).toEqual(DEFAULT_EXPLORER_TOOLBAR_STATE);
		expect(() => saveExplorerToolbarState(DEFAULT_EXPLORER_TOOLBAR_STATE)).not.toThrow();
	});
});
