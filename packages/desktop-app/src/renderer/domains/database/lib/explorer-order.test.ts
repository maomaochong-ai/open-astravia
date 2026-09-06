import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbCatalogScope } from "../../../../preload/api-types/database";
import {
	applyOrderToItems,
	displayOrder,
	flatTableRowContainer,
	loadExplorerOrder,
	moveRowAcross,
	moveRowInSegment,
	saveExplorerOrder,
	scopeRowContainer,
	tableRowContainer,
	toggleRowPin,
} from "./explorer-order";

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

const schemaScope: DbCatalogScope = { kind: "schema", name: "public" };

const EMPTY = { pinned: [], manual: null } as const;

describe("容器键", () => {
	it("tableRowContainer：无 scope = 连接名，有 scope = 与展开态键同构", () => {
		expect(tableRowContainer("pg1")).toBe("pg1");
		expect(tableRowContainer("pg1", schemaScope)).toBe("pg1::schema:public");
		expect(tableRowContainer("pg1", null)).toBe("pg1");
	});

	it("scope 行 / flat 表行容器与 scope 内表行容器互不冲突", () => {
		expect(scopeRowContainer("pg1")).toBe("pg1::scopes");
		expect(flatTableRowContainer("pg1")).toBe("pg1::tables");
		expect(scopeRowContainer("pg1")).not.toBe(tableRowContainer("pg1", schemaScope));
		expect(flatTableRowContainer("pg1")).not.toBe(tableRowContainer("pg1"));
	});
});

describe("displayOrder", () => {
	it("无任何状态时保持原序", () => {
		expect(displayOrder(["a", "b", "c"], EMPTY)).toEqual(["a", "b", "c"]);
	});

	it("置顶行按 pin 次序置前", () => {
		const order = { pinned: ["b", "a"], manual: null };
		expect(displayOrder(["a", "b", "c"], order)).toEqual(["b", "a", "c"]);
	});

	it("pin 集合中已不存在的行被忽略", () => {
		const order = { pinned: ["a", "ghost"], manual: null };
		expect(displayOrder(["a", "b"], order)).toEqual(["a", "b"]);
	});

	it("手动顺序控制非置顶行，新增行补尾", () => {
		const order = { pinned: [], manual: ["c", "a"] };
		expect(displayOrder(["a", "b", "c", "new"], order)).toEqual(["c", "a", "b", "new"]);
	});

	it("manual 中已被置顶的行自动剔除（不重复出现）", () => {
		const order = { pinned: ["a"], manual: ["a", "b"] };
		expect(displayOrder(["a", "b", "c"], order)).toEqual(["a", "b", "c"]);
	});
});

describe("toggleRowPin", () => {
	it("未置顶 → 追加置顶（保持 pin 次序）", () => {
		const order = toggleRowPin(EMPTY, ["a", "b", "c"], "b");
		expect(order.pinned).toEqual(["b"]);
		const again = toggleRowPin(order, ["a", "b", "c"], "a");
		expect(again.pinned).toEqual(["b", "a"]);
	});

	it("已置顶 → 取消置顶", () => {
		const order = toggleRowPin({ pinned: ["a", "b"], manual: null }, ["a", "b", "c"], "a");
		expect(order.pinned).toEqual(["b"]);
	});

	it("行不在容器中时原样返回", () => {
		expect(toggleRowPin(EMPTY, ["a"], "ghost")).toBe(EMPTY);
	});
});

describe("moveRowInSegment", () => {
	it("普通段：行移到目标行之前", () => {
		const order = moveRowInSegment(EMPTY, ["a", "b", "c", "d"], "d", "b");
		expect(displayOrder(["a", "b", "c", "d"], order)).toEqual(["a", "d", "b", "c"]);
		expect(order.manual).not.toBeNull();
	});

	it("普通段：拖到 null = 段末尾", () => {
		const order = moveRowInSegment(EMPTY, ["a", "b", "c"], "a", null);
		expect(displayOrder(["a", "b", "c"], order)).toEqual(["b", "c", "a"]);
	});

	it("pin 段：行移到目标行之前 = 调整置顶次序", () => {
		const order = moveRowInSegment({ pinned: ["a", "b"], manual: null }, ["a", "b", "c"], "b", "a");
		expect(displayOrder(["a", "b", "c"], order)).toEqual(["b", "a", "c"]);
	});

	it("跨段（pin ↔ 普通）原样返回，由 UI 组合 toggleRowPin 完成", () => {
		const pinnedOrder = { pinned: ["a"], manual: null };
		expect(moveRowInSegment(pinnedOrder, ["a", "b", "c"], "a", "b")).toBe(pinnedOrder);
		expect(moveRowInSegment(pinnedOrder, ["a", "b", "c"], "b", "a")).toBe(pinnedOrder);
	});

	it("行不在容器 / from === to 时原样返回", () => {
		expect(moveRowInSegment(EMPTY, ["a", "b"], "ghost", "a")).toBe(EMPTY);
		expect(moveRowInSegment(EMPTY, ["a", "b"], "a", "ghost")).toBe(EMPTY);
		expect(moveRowInSegment(EMPTY, ["a", "b"], "a", "a")).toBe(EMPTY);
	});

	it("顺序恢复到基线时 manual 回落 null", () => {
		const moved = moveRowInSegment(EMPTY, ["a", "b", "c"], "b", "a");
		expect(moved.manual).not.toBeNull();
		expect(moveRowInSegment(moved, ["a", "b", "c"], "a", "b").manual).toBeNull();
	});

	it("置顶后的行从普通段 manual 中剔除（不重复显示）", () => {
		const withManual = moveRowInSegment(EMPTY, ["a", "b", "c", "d"], "d", "b");
		const pinned = toggleRowPin(withManual, ["a", "b", "c", "d"], "d");
		expect(displayOrder(["a", "b", "c", "d"], pinned)).toEqual(["d", "a", "b", "c"]);
	});
});

describe("moveRowAcross", () => {
	it("拖普通行到 pin 行上：置顶并插入 pin 区目标前", () => {
		const order = moveRowAcross({ pinned: ["a"], manual: null }, ["a", "b", "c"], "c", "a");
		expect(order.pinned).toEqual(["c", "a"]);
		expect(displayOrder(["a", "b", "c"], order)).toEqual(["c", "a", "b"]);
	});

	it("拖 pin 行到普通行上：取消置顶并插入普通区目标前", () => {
		const order = moveRowAcross({ pinned: ["c"], manual: null }, ["a", "b", "c"], "c", "b");
		expect(order.pinned).toEqual([]);
		expect(displayOrder(["a", "b", "c"], order)).toEqual(["a", "c", "b"]);
	});

	it("跨段移动保留已存在的 manual 相对顺序", () => {
		const base = moveRowInSegment(EMPTY, ["a", "b", "c", "d"], "d", "b");
		const withPin = toggleRowPin(base, ["a", "b", "c", "d"], "d");
		expect(withPin.pinned).toEqual(["d"]);
		const order = moveRowAcross(withPin, ["a", "b", "c", "d"], "c", "d");
		expect(order.pinned).toEqual(["c", "d"]);
		expect(displayOrder(["a", "b", "c", "d"], order)).toEqual(["c", "d", "a", "b"]);
	});

	it("同段委托给 moveRowInSegment；非法行 / from === to 原样返回", () => {
		expect(moveRowAcross(EMPTY, ["a", "b", "c"], "b", "a")).not.toBe(EMPTY);
		expect(moveRowAcross(EMPTY, ["a", "b"], "ghost", "a")).toBe(EMPTY);
		expect(moveRowAcross(EMPTY, ["a", "b"], "a", "a")).toBe(EMPTY);
	});
});

describe("applyOrderToItems", () => {
	const items = [
		{ name: "a", kind: "table" },
		{ name: "b", kind: "table" },
		{ name: "c", kind: "table" },
	] as const;

	it("无顺序 / 空顺序时返回原数组引用", () => {
		expect(applyOrderToItems(items, undefined)).toBe(items);
		expect(applyOrderToItems(items, EMPTY)).toBe(items);
	});
	it("按 pin + manual 顺序重排", () => {
		const order = { pinned: ["c"], manual: ["a"] };
		const next = applyOrderToItems(items, order);
		expect(next.map((item) => item.name)).toEqual(["c", "a", "b"]);
		expect(next).not.toBe(items);
	});

	it("顺序与原始一致时返回原数组引用", () => {
		const order = { pinned: [], manual: ["a", "b", "c"] };
		expect(applyOrderToItems(items, order)).toBe(items);
	});
});

describe("load/saveExplorerOrder", () => {
	beforeEach(() => {
		vi.stubGlobal("localStorage", createMemStorage());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("空存储 → 空 map；损坏 JSON → 空 map", () => {
		expect(loadExplorerOrder()).toEqual({});
		globalThis.localStorage.setItem("astravia.db.explorer.v1.order", "{oops");
		expect(loadExplorerOrder()).toEqual({});
	});

	it("保存后原样读回（空容器键被剔除）", () => {
		saveExplorerOrder({
			grp: { pinned: ["a", "b"], manual: ["c"] },
			"pg1::schema:public": { pinned: [], manual: ["t2", "t1"] },
			empty: { pinned: [], manual: null },
		});
		expect(loadExplorerOrder()).toEqual({
			grp: { pinned: ["a", "b"], manual: ["c"] },
			"pg1::schema:public": { pinned: [], manual: ["t2", "t1"] },
		});
	});

	it("结构不符的容器被跳过，其余保留", () => {
		globalThis.localStorage.setItem(
			"astravia.db.explorer.v1.order",
			JSON.stringify({
				ok: { pinned: ["x"] },
				bad1: { pinned: "nope" },
				bad2: [1, 2],
				bad3: null,
			}),
		);
		expect(loadExplorerOrder()).toEqual({ ok: { pinned: ["x"], manual: null } });
	});
});
