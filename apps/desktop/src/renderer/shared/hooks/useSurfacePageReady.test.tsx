// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSurfacePageReady } from "./useSurfacePageReady";

afterEach(() => {
	vi.restoreAllMocks();
});

function mockPaintFrames(): FrameRequestCallback[] {
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	const frames: FrameRequestCallback[] = [];
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		frames.push(callback);
		return frames.length;
	});
	return frames;
}

describe("useSurfacePageReady", () => {
	it("前台第一次挂载：绘制完成且模块落地后才就绪", async () => {
		const frames = mockPaintFrames();
		let resolveLoad: (() => void) | undefined;
		const load = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveLoad = () => resolve();
				}),
		);

		const { result } = renderHook(() => useSurfacePageReady(true, load));
		expect(result.current).toBe(false);
		expect(load).not.toHaveBeenCalled();

		await act(async () => {
			frames.shift()?.(0);
		});
		expect(result.current).toBe(false);
		expect(load).not.toHaveBeenCalled();

		await act(async () => {
			frames.shift()?.(16);
		});
		expect(load).toHaveBeenCalledOnce();
		expect(result.current).toBe(false);

		await act(async () => {
			resolveLoad?.();
		});
		expect(result.current).toBe(true);
	});

	it("隐藏预挂立刻开始拉模块，但模块没回来之前仍未就绪", async () => {
		let resolveLoad: (() => void) | undefined;
		const load = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveLoad = () => resolve();
				}),
		);

		const { result } = renderHook(() => useSurfacePageReady(false, load));
		expect(result.current).toBe(false);
		expect(load).toHaveBeenCalledOnce();

		await act(async () => {
			resolveLoad?.();
		});
		expect(result.current).toBe(true);
	});

	it("模块加载失败时也就绪，让 lazy / error boundary 接手", async () => {
		const frames = mockPaintFrames();
		const load = vi.fn(() => Promise.reject(new Error("chunk missing")));

		const { result } = renderHook(() => useSurfacePageReady(true, load));
		await act(async () => {
			frames.shift()?.(0);
			frames.shift()?.(16);
		});
		await act(async () => {
			await Promise.resolve();
		});
		expect(load).toHaveBeenCalledOnce();
		expect(result.current).toBe(true);
	});
});
