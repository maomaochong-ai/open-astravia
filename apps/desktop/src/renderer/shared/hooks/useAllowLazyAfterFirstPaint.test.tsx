// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAllowLazyAfterFirstPaint } from "./useAllowLazyAfterFirstPaint";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("useAllowLazyAfterFirstPaint", () => {
	it("第一次作为前台页挂载时先不许 lazy，等两帧绘制", async () => {
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		const frames: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frames.push(callback);
			return frames.length;
		});

		const { result } = renderHook(() => useAllowLazyAfterFirstPaint(true));
		expect(result.current).toBe(false);

		await act(async () => {
			frames.shift()?.(0);
		});
		expect(result.current).toBe(false);

		await act(async () => {
			frames.shift()?.(16);
		});
		expect(result.current).toBe(true);
	});

	it("隐藏预挂时立刻允许 lazy，好让 chunk 在后台开始加载", () => {
		const { result } = renderHook(() => useAllowLazyAfterFirstPaint(false));
		expect(result.current).toBe(true);
	});
});
