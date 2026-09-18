// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useOwnedHeaderSlot } from "./useOwnedHeaderSlot";

describe("useOwnedHeaderSlot", () => {
	it("切到后台时清掉自己的槽，隐藏态卸载不再清别人的", () => {
		const setValue = vi.fn();
		const { rerender, unmount } = renderHook(
			({ active, value }: { active: boolean; value: string }) => useOwnedHeaderSlot(active, value, setValue),
			{ initialProps: { active: true, value: "chat" } },
		);
		expect(setValue).toHaveBeenCalledWith("chat");
		setValue.mockClear();

		rerender({ active: false, value: "chat" });
		expect(setValue).toHaveBeenCalledWith(null);
		setValue.mockClear();

		unmount();
		expect(setValue).not.toHaveBeenCalled();
	});

	it("仍在前台时卸载才清空自己的槽", () => {
		const setValue = vi.fn();
		const { unmount } = renderHook(() => useOwnedHeaderSlot(true, "chat", setValue));
		setValue.mockClear();
		unmount();
		expect(setValue).toHaveBeenCalledWith(null);
	});
});
