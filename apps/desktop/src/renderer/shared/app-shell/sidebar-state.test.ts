/**
 * @vitest-environment jsdom
 */

import { SIDEBAR_NARROW_BREAKPOINT } from "@shared/hooks/useNarrowScreen";
import { sidebarCollapsedAtom } from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { readSidebarState, subscribeSidebarState } from "./sidebar-state";

function setWindowWidth(width: number): void {
	Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
	window.dispatchEvent(new Event("resize"));
}

const WIDE = SIDEBAR_NARROW_BREAKPOINT + 200;
const NARROW = SIDEBAR_NARROW_BREAKPOINT - 100;

afterEach(() => {
	getDefaultStore().set(sidebarCollapsedAtom, false);
	setWindowWidth(WIDE);
});

describe("readSidebarState", () => {
	it("宽屏展开时侧边栏占着左栏", () => {
		setWindowWidth(WIDE);
		getDefaultStore().set(sidebarCollapsedAtom, false);
		expect(readSidebarState()).toEqual({ collapsed: false, narrow: false, visible: true });
	});

	it("窄屏下 collapsed 仍只表示用户意愿，visible 由窗口宽度否决", () => {
		setWindowWidth(NARROW);
		getDefaultStore().set(sidebarCollapsedAtom, false);
		// 侧边栏改走悬浮覆盖：用户没收起，但它已经不占左栏了。
		expect(readSidebarState()).toEqual({ collapsed: false, narrow: true, visible: false });
	});
});

describe("subscribeSidebarState", () => {
	it("收起/展开都会通知订阅者", () => {
		setWindowWidth(WIDE);
		const seen: boolean[] = [];
		const unsubscribe = subscribeSidebarState((state) => seen.push(state.visible));
		getDefaultStore().set(sidebarCollapsedAtom, true);
		getDefaultStore().set(sidebarCollapsedAtom, false);
		unsubscribe();
		expect(seen).toEqual([false, true]);
	});

	it("跨过窄屏阈值才通知，拖窗口不会打成回调风暴", () => {
		setWindowWidth(WIDE);
		let calls = 0;
		const unsubscribe = subscribeSidebarState(() => {
			calls += 1;
		});
		setWindowWidth(WIDE - 10);
		setWindowWidth(WIDE - 20);
		expect(calls).toBe(0);
		setWindowWidth(NARROW);
		expect(calls).toBe(1);
		setWindowWidth(NARROW - 10);
		expect(calls).toBe(1);
		unsubscribe();
	});

	it("取消订阅后不再收到通知", () => {
		setWindowWidth(WIDE);
		let calls = 0;
		const unsubscribe = subscribeSidebarState(() => {
			calls += 1;
		});
		unsubscribe();
		getDefaultStore().set(sidebarCollapsedAtom, true);
		setWindowWidth(NARROW);
		expect(calls).toBe(0);
	});
});
