// @vitest-environment jsdom

import {
	activityPanelFocusAtom,
	activityPanelOpenAtom,
	activityPanelPreviewAvailableAtom,
	activityPanelResizingAtom,
	activityPanelWidthAtom,
	activityPanelWidthModeAtom,
	setActivityPanelWidthAtom,
	sidebarCollapsedAtom,
	sidebarWidthAtom,
} from "@shared/store/atoms";
import { createStore, Provider } from "jotai";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useActivityPanelModel } from "./useActivityPanelModel";

function setWindowWidth(width: number): void {
	Object.defineProperty(window, "innerWidth", { configurable: true, value: width, writable: true });
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
	window.localStorage.clear();
	setWindowWidth(1600);
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
it("拉满态的面板宽度随窗口 resize 变窄再变宽", () => {
	const store = createStore();
	// 面板必须处于展开态，侧栏占位宽度才会被计入面板上限。
	store.set(activityPanelOpenAtom, true);
	const widths: number[] = [];

	function Probe() {
		const { model } = useActivityPanelModel({
			cwd: null,
			workspaceId: "test",
			definitions: [],
			metaById: new Map(),
		});
		widths.push(model.width);
		return null;
	}

	act(() => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Provider, { store }, createElement(Probe)));
	});

	act(() => store.set(setActivityPanelWidthAtom, "max"));
	expect(widths.at(-1)).toBe(1600 - 220 - 384);

	act(() => {
		setWindowWidth(1000);
		window.dispatchEvent(new Event("resize"));
	});
	expect(widths.at(-1)).toBe(1000 - 220 - 384);

	act(() => {
		setWindowWidth(1600);
		window.dispatchEvent(new Event("resize"));
	});
	expect(widths.at(-1)).toBe(1600 - 220 - 384);
	// 侧栏常驻：窗口变化只改变可用宽度，拉满态仍然是「跟随窗口」。
	expect(store.get(activityPanelWidthModeAtom)).toEqual({ kind: "max" });
});

it("侧边栏常驻：拉满态始终让出侧栏宽度，不再自动收起侧栏", () => {
	const store = createStore();
	store.set(activityPanelOpenAtom, true);
	const widths: number[] = [];

	function Probe() {
		const { model } = useActivityPanelModel({
			cwd: null,
			workspaceId: "test",
			definitions: [],
			metaById: new Map(),
		});
		widths.push(model.width);
		return null;
	}

	act(() => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Provider, { store }, createElement(Probe)));
	});

	act(() => store.set(setActivityPanelWidthAtom, "max"));
	expect(store.get(sidebarCollapsedAtom)).toBe(false);
	expect(widths.at(-1)).toBe(1600 - 220 - 384);
	expect(store.get(activityPanelWidthModeAtom)).toEqual({ kind: "max" });

	// 用户主动收起侧栏时，拉满态才占用整窗宽度；展开回来又让出去，全程不改宽度意图。
	act(() => store.set(sidebarCollapsedAtom, true));
	expect(widths.at(-1)).toBe(1600 - 384);
	expect(store.get(activityPanelWidthModeAtom)).toEqual({ kind: "max" });

	act(() => store.set(sidebarCollapsedAtom, false));
	expect(widths.at(-1)).toBe(1600 - 220 - 384);
	expect(store.get(activityPanelWidthModeAtom)).toEqual({ kind: "max" });
});

it("面板拖动期间只同步离散阈值，结束时才提交并持久化最终宽度", () => {
	const store = createStore();
	store.set(activityPanelOpenAtom, true);
	let latest: ReturnType<typeof useActivityPanelModel> | null = null;

	function Probe() {
		latest = useActivityPanelModel({
			cwd: null,
			workspaceId: "test",
			definitions: [],
			metaById: new Map(),
		});
		return null;
	}

	act(() => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Provider, { store }, createElement(Probe)));
	});

	const initialWidth = store.get(activityPanelWidthAtom);
	act(() => latest?.actions.onResizeStart());
	expect(store.get(activityPanelResizingAtom)).toBe(true);

	act(() => {
		latest?.actions.onResize(480);
		latest?.actions.onResize(519);
	});
	expect(store.get(activityPanelWidthAtom)).toBe(initialWidth);
	expect(store.get(activityPanelPreviewAvailableAtom)).toBe(false);
	expect(localStorage.getItem("astravia-activity-panel-width")).toBeNull();

	act(() => latest?.actions.onResize(540));
	expect(store.get(activityPanelWidthAtom)).toBe(initialWidth);
	expect(store.get(activityPanelPreviewAvailableAtom)).toBe(true);

	act(() => latest?.actions.onResizeEnd(540));
	expect(store.get(activityPanelWidthAtom)).toBe(540);
	expect(store.get(activityPanelResizingAtom)).toBe(false);
	expect(localStorage.getItem("astravia-activity-panel-width")).toBe("540");
});

/**
 * 窗口放不下「侧栏 + 面板最小宽 + 聊天区最小宽」时，面板改从底部抽屉滑出：
 * 聊天区宽度不变，侧栏也不用为面板让位。测试里默认侧栏宽 220。
 */
it("窗口放不下侧栏与面板共存时，面板改为底部抽屉", () => {
	const store = createStore();
	store.set(activityPanelOpenAtom, true);
	// 赋值发生在 Probe 里，TS 看不到，直接读局部变量会被收窄成 null；
	// 放进一个显式类型的容器，读取点拿到的就是声明的联合类型。
	const latest: { current: ReturnType<typeof useActivityPanelModel> | null } = { current: null };

	function Probe() {
		latest.current = useActivityPanelModel({
			cwd: null,
			workspaceId: "test",
			definitions: [],
			metaById: new Map(),
		});
		return null;
	}

	setWindowWidth(1000);
	act(() => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Provider, { store }, createElement(Probe)));
	});
	// 1000 >= 220 + 260 + 384，面板照旧占一列。
	expect(latest.current?.model.narrowSheet).toBe(false);
	expect(latest.current?.model.bottomSheet).toBe(false);

	act(() => {
		setWindowWidth(800);
		window.dispatchEvent(new Event("resize"));
	});
	expect(latest.current?.model.narrowSheet).toBe(true);
	expect(latest.current?.model.bottomSheet).toBe(true);

	// 用户手动收起侧栏后占位降到 0，800 的窗口又放得下了。
	act(() => store.set(sidebarCollapsedAtom, true));
	expect(latest.current?.model.narrowSheet).toBe(false);
	expect(latest.current?.model.bottomSheet).toBe(false);
});

/** 抽屉阈值随侧栏宽度变化，且铺满时不能被降级成抽屉。 */
it("抽屉阈值跟随侧栏宽度，铺满时不降级成抽屉", () => {
	const store = createStore();
	store.set(activityPanelOpenAtom, true);
	// 同上：赋值在 Probe 里，直接读局部变量会被收窄成 null。
	const latest: { current: ReturnType<typeof useActivityPanelModel> | null } = { current: null };

	function Probe() {
		latest.current = useActivityPanelModel({
			cwd: null,
			workspaceId: "test",
			definitions: [],
			metaById: new Map(),
		});
		return null;
	}

	// 900 >= 220 + 260 + 384：占列。
	setWindowWidth(900);
	act(() => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Provider, { store }, createElement(Probe)));
	});
	expect(latest.current?.model.narrowSheet).toBe(false);

	// 侧栏拖宽到 300 后阈值抬到 944，900 的窗口就放不下了。
	act(() => store.set(sidebarWidthAtom, 300));
	expect(latest.current?.model.narrowSheet).toBe(true);

	// 铺满时外壳本就让位、面板占满整行：不能又降级成抽屉，否则铺满按钮只剩图标变化。
	act(() => store.set(activityPanelFocusAtom, true));
	expect(latest.current?.model.narrowSheet).toBe(false);
	expect(latest.current?.model.bottomSheet).toBe(false);
});
