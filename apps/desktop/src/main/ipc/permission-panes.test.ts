import { describe, expect, it } from "vitest";
import { HELPER_REGISTERED_PANES, PANE_URLS, type PermissionKind } from "./permission-panes";

describe("HELPER_REGISTERED_PANES", () => {
	it("只包含由 appshot helper 触发的两项隐私权限", () => {
		expect([...HELPER_REGISTERED_PANES].sort()).toEqual(["accessibility", "screen-recording"]);
	});

	it("每一项都有可打开的系统设置面板", () => {
		for (const kind of HELPER_REGISTERED_PANES) {
			expect(PANE_URLS[kind]).toMatch(/^x-apple\.systempreferences:/);
		}
	});

	it("不把不在 PANE_URLS 里的面板当成 helper 权限", () => {
		const panes = Object.keys(PANE_URLS) as PermissionKind[];
		expect(panes.filter((kind) => HELPER_REGISTERED_PANES.has(kind))).toHaveLength(2);
	});
});
