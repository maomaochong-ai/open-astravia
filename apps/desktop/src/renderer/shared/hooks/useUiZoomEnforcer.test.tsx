// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiZoomEnforcer } from "./useUiZoomEnforcer";

// 模拟渲染进程里 Chromium 的真实缩放；applyZoom 之后才变。
let actual = 1.1;
const applyZoom = vi.fn((factor: number) => {
	actual = factor;
});

function setVisibility(state: "visible" | "hidden") {
	Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
	document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
	vi.useFakeTimers();
	actual = 1.1;
	applyZoom.mockClear();
	Object.defineProperty(window, "astravia", {
		configurable: true,
		value: { uiZoom: { getActualZoom: () => actual, applyZoom } },
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe("useUiZoomEnforcer", () => {
	it("实际缩放已是档位时不写", () => {
		renderHook(() => useUiZoomEnforcer(1.1, true));
		expect(applyZoom).not.toHaveBeenCalled();
	});

	it("窗口隐藏再唤起后实际缩放被改回旧值：重新可见时纠正回档位", () => {
		renderHook(() => useUiZoomEnforcer(1.1, true));
		setVisibility("hidden");
		actual = 0.9; // Chromium 在重新显示时套了陈旧值，主进程不知情

		setVisibility("visible");

		expect(applyZoom).toHaveBeenCalledWith(1.1);
		expect(actual).toBe(1.1);
	});

	it("改回发生在显示之后一小会儿：延后核对也能纠正", () => {
		renderHook(() => useUiZoomEnforcer(1.1, true));
		setVisibility("visible");
		expect(applyZoom).not.toHaveBeenCalled();

		actual = 1;
		vi.advanceTimersByTime(300);

		expect(applyZoom).toHaveBeenCalledWith(1.1);
	});

	it("重新获得焦点时也核对", () => {
		renderHook(() => useUiZoomEnforcer(1.25, true));
		expect(applyZoom).toHaveBeenCalledWith(1.25); // 挂载时实际是 1.1，先纠正到 1.25
		applyZoom.mockClear();

		actual = 1;
		window.dispatchEvent(new Event("focus"));

		expect(applyZoom).toHaveBeenCalledWith(1.25);
	});

	it("档位还没从主进程读到（enabled=false）时不拿占位默认值去改实际缩放", () => {
		renderHook(() => useUiZoomEnforcer(1, false));
		setVisibility("visible");
		window.dispatchEvent(new Event("focus"));
		vi.advanceTimersByTime(300);
		expect(applyZoom).not.toHaveBeenCalled();
	});

	it("档位变化后立即按新档位纠正", () => {
		const { rerender } = renderHook(({ f }) => useUiZoomEnforcer(f, true), { initialProps: { f: 1.1 } });
		rerender({ f: 1.5 });
		expect(applyZoom).toHaveBeenLastCalledWith(1.5);
	});

	it("卸载后不再响应", () => {
		const { unmount } = renderHook(() => useUiZoomEnforcer(1.1, true));
		unmount();
		actual = 0.9;
		setVisibility("visible");
		window.dispatchEvent(new Event("focus"));
		vi.advanceTimersByTime(300);
		expect(applyZoom).not.toHaveBeenCalled();
	});
});
