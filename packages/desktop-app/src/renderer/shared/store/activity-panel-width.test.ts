// @vitest-environment jsdom

import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** jsdom 未提供 localStorage，这里补一个内存实现，顺便让测试能预置历史记录。 */
function installStorage(seed?: Record<string, string>): Map<string, string> {
	const store = new Map<string, string>(Object.entries(seed ?? {}));
	vi.stubGlobal("localStorage", {
		clear: () => store.clear(),
		getItem: (key: string) => store.get(key) ?? null,
		removeItem: (key: string) => void store.delete(key),
		setItem: (key: string, value: string) => void store.set(key, value),
	});
	return store;
}

function setWindowWidth(width: number): void {
	Object.defineProperty(window, "innerWidth", { configurable: true, value: width, writable: true });
}

/**
 * 模块加载时就会读取持久化的宽度意图，所以每个用例都重新导入一次，
 * 以便在导入前预置 localStorage 与窗口宽度。
 */
async function loadAtoms() {
	vi.resetModules();
	return await import("./activity-atoms");
}

/** 该窗口宽度下面板能达到的最大宽度（= 窗口宽 - 聊天区最小宽 454）。 */
function maxAt(windowWidth: number): number {
	return windowWidth - 454;
}

describe("活动面板宽度意图", () => {
	beforeEach(() => {
		installStorage();
		setWindowWidth(1200);
	});

	it('写入 "max" 后，窗口变宽时面板宽度跟着变大', async () => {
		const atoms = await loadAtoms();
		const store = createStore();
		store.set(atoms.setActivityPanelWidthAtom, "max");
		expect(store.get(atoms.activityPanelWidthAtom)).toBe(maxAt(1200));

		setWindowWidth(1600);
		store.set(atoms.syncActivityPanelWidthToWindowAtom, 1600);
		expect(store.get(atoms.activityPanelWidthAtom)).toBe(maxAt(1600));

		setWindowWidth(900);
		store.set(atoms.syncActivityPanelWidthToWindowAtom, 900);
		expect(store.get(atoms.activityPanelWidthAtom)).toBe(maxAt(900));
	});

	it("用户拖动分隔条即退出拉满态，之后不再跟随窗口", async () => {
		const atoms = await loadAtoms();
		const store = createStore();
		store.set(atoms.setActivityPanelWidthAtom, "max");
		expect(store.get(atoms.activityPanelWidthModeAtom)).toEqual({ kind: "max" });

		store.set(atoms.setTransientActivityPanelWidthAtom, 500);
		expect(store.get(atoms.activityPanelWidthModeAtom)).toEqual({ kind: "fixed", px: 500 });

		setWindowWidth(1600);
		store.set(atoms.syncActivityPanelWidthToWindowAtom, 1600);
		expect(store.get(atoms.activityPanelWidthAtom)).toBe(500);
	});

	it("固定宽度在窗口变窄时夹紧、变宽时回到用户指定的宽度", async () => {
		setWindowWidth(1600);
		const atoms = await loadAtoms();
		const store = createStore();
		store.set(atoms.setActivityPanelWidthAtom, 900);
		expect(store.get(atoms.activityPanelWidthAtom)).toBe(900);

		setWindowWidth(1000);
		store.set(atoms.syncActivityPanelWidthToWindowAtom, 1000);
		expect(store.get(atoms.activityPanelWidthAtom)).toBe(maxAt(1000));

		setWindowWidth(1600);
		store.set(atoms.syncActivityPanelWidthToWindowAtom, 1600);
		expect(store.get(atoms.activityPanelWidthAtom)).toBe(900);
	});

	it("持久化的是意图：拉满存哨兵值，固定宽度存像素", async () => {
		const atoms = await loadAtoms();
		const store = createStore();
		store.set(atoms.setActivityPanelWidthAtom, "max");
		expect(localStorage.getItem(atoms.ACTIVITY_PANEL_WIDTH_STORAGE_KEY)).toBe("max");

		store.set(atoms.activityPanelWidthAtom, 480);
		expect(localStorage.getItem(atoms.ACTIVITY_PANEL_WIDTH_STORAGE_KEY)).toBe("480");
	});

	it("拖拽中的瞬时宽度不落盘，拖拽结束才写入最终值", async () => {
		const atoms = await loadAtoms();
		const store = createStore();
		store.set(atoms.setActivityPanelWidthAtom, 480);
		store.set(atoms.setTransientActivityPanelWidthAtom, (prev) => prev + 60);
		expect(store.get(atoms.activityPanelWidthAtom)).toBe(540);
		expect(localStorage.getItem(atoms.ACTIVITY_PANEL_WIDTH_STORAGE_KEY)).toBe("480");

		store.set(atoms.persistActivityPanelWidthAtom);
		expect(localStorage.getItem(atoms.ACTIVITY_PANEL_WIDTH_STORAGE_KEY)).toBe("540");
	});
});

describe("tab 拖拽期间的宽度请求", () => {
	beforeEach(() => {
		installStorage();
		setWindowWidth(1200);
	});

	it("拖拽中挂起，结束时只应用最后一次请求，且拉满态照样生效", async () => {
		const atoms = await loadAtoms();
		const store = createStore();
		store.set(atoms.setActivityPanelWidthAtom, 480);

		store.set(atoms.setActivityPanelTabDraggingAtom, true);
		store.set(atoms.setActivityPanelWidthAtom, 600);
		store.set(atoms.setActivityPanelWidthAtom, "max");
		expect(store.get(atoms.activityPanelWidthAtom)).toBe(480);

		store.set(atoms.setActivityPanelTabDraggingAtom, false);
		expect(store.get(atoms.activityPanelWidthModeAtom)).toEqual({ kind: "max" });
		expect(store.get(atoms.activityPanelWidthAtom)).toBe(maxAt(1200));
	});
});

describe("历史 localStorage 记录", () => {
	it("旧版存的裸数字仍按固定宽度读入", async () => {
		installStorage({ "vetta-activity-panel-width": "820" });
		setWindowWidth(1600);
		const atoms = await loadAtoms();
		const store = createStore();
		expect(store.get(atoms.activityPanelWidthModeAtom)).toEqual({ kind: "fixed", px: 820 });
		expect(store.get(atoms.activityPanelWidthAtom)).toBe(820);
	});

	it('"max" 哨兵值读回拉满态，并按当前窗口求值', async () => {
		installStorage({ "vetta-activity-panel-width": "max" });
		setWindowWidth(1600);
		const atoms = await loadAtoms();
		const store = createStore();
		expect(store.get(atoms.activityPanelWidthModeAtom)).toEqual({ kind: "max" });
		expect(store.get(atoms.activityPanelWidthAtom)).toBe(maxAt(1600));
	});
});
