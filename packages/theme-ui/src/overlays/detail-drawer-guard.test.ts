import { describe, expect, it } from "vitest";
import { shouldCloseDetailDrawer } from "./detail-drawer-guard";

describe("shouldCloseDetailDrawer", () => {
	it("忽略 Dialog 仍挂载时的关闭请求，避免弹窗交互连带关掉抽屉", () => {
		expect(shouldCloseDetailDrawer(false, { querySelector: () => ({}) })).toBe(false);
	});

	it("Dialog 全部卸载后才放行关闭", () => {
		expect(shouldCloseDetailDrawer(false, { querySelector: () => null })).toBe(true);
	});

	it("打开请求从不触发关闭", () => {
		expect(shouldCloseDetailDrawer(true, { querySelector: () => null })).toBe(false);
	});
});
