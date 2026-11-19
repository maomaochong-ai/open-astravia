// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UiZoomHud } from "./UiZoomHud";

let emit: (factor: number) => void = () => {};
const off = vi.fn();

beforeEach(() => {
	vi.useFakeTimers();
	off.mockClear();
	Object.defineProperty(window, "astravia", {
		configurable: true,
		value: {
			uiZoom: {
				onShortcutZoom: (handler: (factor: number) => void) => {
					emit = handler;
					return off;
				},
			},
		},
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("UiZoomHud", () => {
	it("没有快捷键缩放时什么都不显示", () => {
		render(<UiZoomHud />);
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("快捷键缩放后显示当前百分比，约 1.2 秒后淡出", () => {
		render(<UiZoomHud />);

		act(() => emit(1.1));
		expect(screen.getByRole("status").textContent).toContain("110%");
		expect(screen.getByRole("status").getAttribute("data-visible")).toBe("true");

		act(() => vi.advanceTimersByTime(1200));
		expect(screen.getByRole("status").getAttribute("data-visible")).toBe("false");
	});

	it("连续缩放会刷新数值并重新计时", () => {
		render(<UiZoomHud />);

		act(() => emit(1.1));
		act(() => vi.advanceTimersByTime(1000));
		act(() => emit(1.25));
		act(() => vi.advanceTimersByTime(1000));

		expect(screen.getByRole("status").textContent).toContain("125%");
		expect(screen.getByRole("status").getAttribute("data-visible")).toBe("true");
	});

	it("卸载时取消订阅", () => {
		const { unmount } = render(<UiZoomHud />);
		unmount();
		expect(off).toHaveBeenCalledTimes(1);
	});
});
