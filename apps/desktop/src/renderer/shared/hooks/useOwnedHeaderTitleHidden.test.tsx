// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { describe, expect, it } from "vitest";
import { pageHeaderTitleHiddenAtom } from "@shared/store/atoms";
import { useOwnedHeaderTitleHidden } from "./useOwnedHeaderTitleHidden";

describe("useOwnedHeaderTitleHidden", () => {
	it("前台隐藏标题，切到后台恢复", () => {
		const store = getDefaultStore();
		store.set(pageHeaderTitleHiddenAtom, false);
		const { rerender } = renderHook(({ active }: { active: boolean }) => useOwnedHeaderTitleHidden(active), {
			initialProps: { active: true },
		});
		expect(store.get(pageHeaderTitleHiddenAtom)).toBe(true);
		rerender({ active: false });
		expect(store.get(pageHeaderTitleHiddenAtom)).toBe(false);
	});
});
