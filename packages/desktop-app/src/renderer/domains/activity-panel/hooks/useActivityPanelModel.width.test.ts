// @vitest-environment jsdom

import { createStore, Provider } from "jotai";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** jsdom 未提供 localStorage；多个 store 模块在导入期就会读写它。 */
function installStorage(): void {
	const store = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		clear: () => store.clear(),
		getItem: (key: string) => store.get(key) ?? null,
		removeItem: (key: string) => void store.delete(key),
		setItem: (key: string, value: string) => void store.set(key, value),
	});
}

function setWindowWidth(width: number): void {
	Object.defineProperty(window, "innerWidth", { configurable: true, value: width, writable: true });
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
	installStorage();
	setWindowWidth(1600);
	vi.resetModules();
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.append(container);
});

afterEach(() => {
	act(() => root?.unmount());
	container?.remove();
	root = null;
	container = null;
});

/**
 * 窗口 resize 与面板宽度之间的接线：原子层的意图解析已由 activity-panel-width.test.ts 覆盖，
 * 这里验证 useWindowWidth → sync 这一步在真实 React 树里确实跑通。
 */
it("拉满态的面板宽度随窗口 resize 变窄再变宽", async () => {
	const { activityPanelOpenAtom, setActivityPanelWidthAtom } = await import("@shared/store/atoms");
	const { useActivityPanelModel } = await import("./useActivityPanelModel");

	const store = createStore();
	// 面板必须是展开态，否则「面板过宽自动收起侧边栏」那段联动不会参与，测不到它是否会把
	// 拉满态改写成固定宽度。
	store.set(activityPanelOpenAtom, true);
	const widths: number[] = [];

	function Probe() {
		const { model } = useActivityPanelModel({ cwd: null, definitions: [], metaById: new Map() });
		widths.push(model.width);
		return null;
	}

	act(() => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Provider, { store }, createElement(Probe)));
	});

	act(() => store.set(setActivityPanelWidthAtom, "max"));
	expect(widths.at(-1)).toBe(1600 - 384);

	act(() => {
		setWindowWidth(1000);
		window.dispatchEvent(new Event("resize"));
	});
	expect(widths.at(-1)).toBe(1000 - 384);

	act(() => {
		setWindowWidth(1600);
		window.dispatchEvent(new Event("resize"));
	});
	expect(widths.at(-1)).toBe(1600 - 384);
	// 侧边栏联动曾在这一步用滞后一帧的宽度误判，把拉满态改写成 openLimit 的固定宽度。
	const { activityPanelWidthModeAtom } = await import("@shared/store/atoms");
	expect(store.get(activityPanelWidthModeAtom)).toEqual({ kind: "max" });
});

it("用户手动展开侧边栏时，过宽的面板仍被压到 openLimit 并转为固定宽度", async () => {
	const { activityPanelOpenAtom, activityPanelWidthModeAtom, setActivityPanelWidthAtom, sidebarCollapsedAtom } =
		await import("@shared/store/atoms");
	const { useActivityPanelModel } = await import("./useActivityPanelModel");

	const store = createStore();
	store.set(activityPanelOpenAtom, true);
	const widths: number[] = [];

	function Probe() {
		const { model } = useActivityPanelModel({ cwd: null, definitions: [], metaById: new Map() });
		widths.push(model.width);
		return null;
	}

	act(() => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Provider, { store }, createElement(Probe)));
	});

	// 拉满会自动收起侧边栏；用户手动展开回来，面板必须让出侧边栏的宽度。
	act(() => store.set(setActivityPanelWidthAtom, "max"));
	expect(store.get(sidebarCollapsedAtom)).toBe(true);

	act(() => store.set(sidebarCollapsedAtom, false));
	expect(widths.at(-1)).toBe(1600 - 220 - 384);
	expect(store.get(activityPanelWidthModeAtom)).toEqual({ kind: "fixed", px: 1600 - 220 - 384 });
});
