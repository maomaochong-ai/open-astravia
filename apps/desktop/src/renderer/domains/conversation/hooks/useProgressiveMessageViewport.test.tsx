// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProgressiveMessageViewport } from "./useProgressiveMessageViewport";

const frames: FrameRequestCallback[] = [];
const idleCallbacks = new Map<number, IdleRequestCallback>();

beforeEach(() => {
	vi.useFakeTimers();
	frames.length = 0;
	idleCallbacks.clear();
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
		const id = idleCallbacks.size + 1;
		idleCallbacks.set(id, callback);
		return id;
	});
	vi.stubGlobal("cancelIdleCallback", (id: number) => idleCallbacks.delete(id));
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("仅在有可恢复视口状态时收窄预渲染，并在首屏稳定后的空闲期扩大", () => {
	const { result, rerender } = renderHook(
		({ sessionId, hasMessages, hasRestorableState }) =>
			useProgressiveMessageViewport(sessionId, hasMessages, hasRestorableState),
		{
			initialProps: { sessionId: "session-a", hasMessages: true, hasRestorableState: false },
		},
	);
	expect(result.current).toBe("expanded");

	rerender({ sessionId: "session-b", hasMessages: false, hasRestorableState: false });
	expect(result.current).toBe("initial");
	act(() => vi.runAllTimers());
	expect(result.current).toBe("initial");

	rerender({ sessionId: "session-b", hasMessages: true, hasRestorableState: false });
	expect(result.current).toBe("expanded");
	expect(frames).toHaveLength(0);

	rerender({ sessionId: "session-c", hasMessages: true, hasRestorableState: true });
	expect(result.current).toBe("initial");

	act(() => frames.shift()?.(0));
	act(() => frames.shift()?.(16));
	act(() => vi.advanceTimersByTime(399));
	expect(idleCallbacks).toHaveLength(0);
	expect(result.current).toBe("initial");

	act(() => vi.advanceTimersByTime(1));
	expect(idleCallbacks).toHaveLength(1);
	act(() => idleCallbacks.values().next().value?.({ didTimeout: false, timeRemaining: () => 8 }));
	expect(result.current).toBe("expanded");
});

it("空壳异步接入缓存历史后仍等待首屏稳定再扩大视口", () => {
	const { result, rerender } = renderHook(
		({ hasMessages, hasRestorableState }) =>
			useProgressiveMessageViewport("session-a", hasMessages, hasRestorableState),
		{
			initialProps: { hasMessages: false, hasRestorableState: false },
		},
	);
	expect(result.current).toBe("initial");

	rerender({ hasMessages: true, hasRestorableState: true });
	expect(result.current).toBe("initial");

	act(() => frames.shift()?.(0));
	act(() => frames.shift()?.(16));
	act(() => vi.advanceTimersByTime(399));
	expect(idleCallbacks).toHaveLength(0);
	expect(result.current).toBe("initial");

	act(() => vi.advanceTimersByTime(1));
	const idleCallback = [...idleCallbacks.values()].at(-1);
	act(() => idleCallback?.({ didTimeout: false, timeRemaining: () => 8 }));
	expect(result.current).toBe("expanded");
});

it("快速连续切换会取消旧会话的扩大任务", () => {
	const { result, rerender } = renderHook(
		({ sessionId, hasMessages, hasRestorableState }) =>
			useProgressiveMessageViewport(sessionId, hasMessages, hasRestorableState),
		{
			initialProps: { sessionId: "session-a", hasMessages: true, hasRestorableState: false },
		},
	);

	rerender({ sessionId: "session-b", hasMessages: true, hasRestorableState: true });
	act(() => frames.shift()?.(0));
	rerender({ sessionId: "session-a", hasMessages: true, hasRestorableState: true });
	expect(result.current).toBe("initial");

	act(() => vi.runAllTimers());
	for (const callback of idleCallbacks.values()) {
		act(() => callback({ didTimeout: false, timeRemaining: () => 8 }));
	}
	expect(result.current).toBe("initial");

	frames.shift(); // 已取消的 session-b 第二帧
	act(() => frames.shift()?.(16));
	act(() => frames.shift()?.(32));
	act(() => vi.advanceTimersByTime(400));
	const latestIdleCallback = [...idleCallbacks.values()].at(-1);
	act(() => latestIdleCallback?.({ didTimeout: false, timeRemaining: () => 8 }));
	expect(result.current).toBe("expanded");
});
