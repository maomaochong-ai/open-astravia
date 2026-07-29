import { describe, expect, it, vi } from "vitest";
import { shouldCloseAbilityDetailDrawer } from "./ability-detail-modal-guard";

describe("shouldCloseAbilityDetailDrawer", () => {
	it("keeps the drawer open while a portal dialog is mounted", () => {
		const querySelector = vi.fn(() => ({}));

		expect(shouldCloseAbilityDetailDrawer(false, { querySelector })).toBe(false);
		expect(querySelector).toHaveBeenCalledWith('[data-slot="dialog-content"]');
	});

	it("allows the drawer to close after the dialog is removed", () => {
		expect(shouldCloseAbilityDetailDrawer(false, { querySelector: () => null })).toBe(true);
	});

	it("does not treat an open notification as a close request", () => {
		expect(shouldCloseAbilityDetailDrawer(true, { querySelector: () => null })).toBe(false);
	});
});
