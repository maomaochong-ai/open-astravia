// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProgressiveMessageViewport } from "./useProgressiveMessageViewport";

const frames: FrameRequestCallback[] = [];
const idleCallbacks = new Map<number, IdleRequestCallback>();
let nextIdleCallbackId = 1;

beforeEach(() => {
	vi.useFakeTimers();
	frames.length = 0;
	idleCallbacks.clear();
	nextIdleCallbackId = 1;
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
		const id = nextIdleCallbackId++;
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

it("冷、热会话都先收窄预渲染，并在首屏稳定后的空闲期扩大", () => {
	const { result } = renderHook(() => useProgressiveMessageViewport("session-a", true));
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
		({ hasMessages }) => useProgressiveMessageViewport("session-a", hasMessages),
		{
			initialProps: { hasMessages: false },
		},
	);
	expect(result.current).toBe("initial");

	rerender({ hasMessages: true });
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
		({ sessionId, hasMessages }) => useProgressiveMessageViewport(sessionId, hasMessages),
		{
			initialProps: { sessionId: "session-a", hasMessages: true },
		},
	);

	rerender({ sessionId: "session-b", hasMessages: true });
	act(() => frames.shift()?.(0));
	rerender({ sessionId: "session-a", hasMessages: true });
	expect(result.current).toBe("initial");

	act(() => vi.runAllTimers());
	for (const callback of idleCallbacks.values()) {
		act(() => callback({ didTimeout: false, timeRemaining: () => 8 }));
	}
	expect(result.current).toBe("initial");
});
