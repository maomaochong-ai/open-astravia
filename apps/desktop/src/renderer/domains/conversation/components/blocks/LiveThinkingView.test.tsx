// @vitest-environment jsdom
import { LiveThinkingView } from "@vetta-org/theme-ui/chat";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.unstubAllGlobals();
});

/** 卡片内的滚动窗口：带 maxHeight 的那层。 */
function viewportOf(container: HTMLElement): HTMLElement {
	const viewport = container.querySelector<HTMLElement>("[style*='max-height']");
	if (!viewport) throw new Error("viewport not rendered");
	return viewport;
}

function mockScrollMetrics(element: HTMLElement, scrollHeight: number, clientHeight: number): void {
	Object.defineProperties(element, {
		scrollHeight: { configurable: true, get: () => scrollHeight },
		clientHeight: { configurable: true, get: () => clientHeight },
		scrollTop: { configurable: true, writable: true, value: 0 },
	});
}

describe("LiveThinkingView", () => {
	it("short appends land on the bottom in one frame instead of easing frame by frame", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());

		const { container, rerender } = render(<LiveThinkingView text="one line" />);
		const viewport = viewportOf(container);
		// 一行半的追加：毛玻璃窗口每帧都要整窗重合成，这么短的距离不值得一串 rAF。
		mockScrollMetrics(viewport, 96, 64);
		frames.length = 0;
		rerender(<LiveThinkingView text="one line\ntwo lines" />);

		expect(frames).toHaveLength(1);
		act(() => frames.shift()?.(0));
		expect(viewport.scrollTop).toBe(32);
		expect(frames).toHaveLength(0);
	});

	it("large jumps still ease and finish without snapping mid-way", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());

		const { container, rerender } = render(<LiveThinkingView text="one line" />);
		const viewport = viewportOf(container);
		mockScrollMetrics(viewport, 364, 64);
		frames.length = 0;
		rerender(<LiveThinkingView text="one line\nmany more lines" />);

		act(() => frames.shift()?.(0));
		expect(viewport.scrollTop).toBeGreaterThan(0);
		expect(viewport.scrollTop).toBeLessThan(300);
		expect(frames).toHaveLength(1);

		// 缓动一旦开始就走到底：进入 48px 以内也不突然跳到终点。
		let guard = 0;
		while (300 - viewport.scrollTop > 48 && guard++ < 200) act(() => frames.shift()?.(0));
		expect(frames).toHaveLength(1);
		act(() => frames.shift()?.(0));
		expect(viewport.scrollTop).toBeLessThan(300);
		while (frames.length > 0 && guard++ < 400) act(() => frames.shift()?.(0));
		expect(viewport.scrollTop).toBe(300);
	});

	it("用 CSS grid 入场，而不是 motion 的 height:auto", () => {
		const { container } = render(<LiveThinkingView text="thinking..." />);
		const root = container.firstElementChild as HTMLElement | null;
		expect(root).not.toBeNull();
		expect(root?.className).toContain("grid");
		expect(root?.className).toContain("grid-rows-[0fr]");
		expect(root?.getAttribute("style") ?? "").not.toMatch(/height/i);
	});
});
