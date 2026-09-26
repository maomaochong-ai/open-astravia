import { describe, expect, it, vi } from "vitest";
import { shouldCloseAbilityDetailDrawer } from "./ability-detail-modal-guard";

/** 创建一个最小 mock Element（带 getAttribute，data-state 默认 "open"）。 */
function mockDialogElement(state: string = "open"): Element {
	return {
		getAttribute: (_name: string) => state,
	} as unknown as Element;
}

describe("shouldCloseAbilityDetailDrawer", () => {
	it("keeps the drawer open while a portal dialog is mounted with data-state=open", () => {
		const querySelector = vi.fn(() => mockDialogElement("open"));
		expect(shouldCloseAbilityDetailDrawer(false, { querySelector })).toBe(false);
		expect(querySelector).toHaveBeenCalledWith('[data-slot="dialog-content"]');
	});

	it("allows the drawer to close when dialog exists but is already closing (data-state=closed)", () => {
		const querySelector = vi.fn(() => mockDialogElement("closed"));
		expect(shouldCloseAbilityDetailDrawer(false, { querySelector })).toBe(true);
	});

	it("allows the drawer to close after the dialog is removed", () => {
		const querySelector = vi.fn(() => null);
		expect(shouldCloseAbilityDetailDrawer(false, { querySelector })).toBe(true);
	});

	it("does not treat an open request as a close (nextOpen=true keeps old behavior)", () => {
		const querySelector = vi.fn(() => null);
		expect(shouldCloseAbilityDetailDrawer(true, { querySelector })).toBe(false);
	});
});
