// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDeferredMessageEnhancements } from "./useDeferredMessageEnhancements";

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

it("首屏绘制并稳定后才启用非关键消息派生", () => {
	const { result } = renderHook(() => useDeferredMessageEnhancements("session-a", true));
	expect(result.current).toBe(false);

	act(() => frames.shift()?.(0));
	act(() => frames.shift()?.(16));
	act(() => vi.advanceTimersByTime(399));
	expect(idleCallbacks).toHaveLength(0);
	expect(result.current).toBe(false);

	act(() => vi.advanceTimersByTime(1));
	expect(idleCallbacks).toHaveLength(1);
	act(() => idleCallbacks.values().next().value?.({ didTimeout: false, timeRemaining: () => 8 }));
	expect(result.current).toBe(true);
});

it("空壳异步接入消息后仍先给首屏两帧绘制机会", () => {
	const { result, rerender } = renderHook(
		({ hasMessages }) => useDeferredMessageEnhancements("session-a", hasMessages),
		{ initialProps: { hasMessages: false } },
	);
	expect(result.current).toBe(false);

	rerender({ hasMessages: true });
	expect(result.current).toBe(false);

	act(() => frames.shift()?.(0));
	act(() => frames.shift()?.(16));
	act(() => vi.advanceTimersByTime(400));
	const idleCallback = [...idleCallbacks.values()].at(-1);
	act(() => idleCallback?.({ didTimeout: false, timeRemaining: () => 8 }));
	expect(result.current).toBe(true);
});

it("快速连续切换会取消旧会话的非关键任务", () => {
	const { result, rerender } = renderHook(
		({ sessionId, hasMessages }) => useDeferredMessageEnhancements(sessionId, hasMessages),
		{ initialProps: { sessionId: "session-a", hasMessages: true } },
	);

	rerender({ sessionId: "session-b", hasMessages: true });
	act(() => frames.shift()?.(0));
	rerender({ sessionId: "session-a", hasMessages: true });
	expect(result.current).toBe(false);

	act(() => vi.runAllTimers());
	for (const callback of idleCallbacks.values()) {
		act(() => callback({ didTimeout: false, timeRemaining: () => 8 }));
	}
	expect(result.current).toBe(false);
});
