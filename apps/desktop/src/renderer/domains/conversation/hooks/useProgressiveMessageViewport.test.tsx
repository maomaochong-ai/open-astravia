// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProgressiveMessageViewport } from "./useProgressiveMessageViewport";

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("切换会话时先收窄屏幕外预渲染，历史出现后再异步扩大", () => {
	const { result, rerender } = renderHook(
		({ sessionId, hasMessages }: { sessionId: string; hasMessages: boolean }) =>
			useProgressiveMessageViewport(sessionId, hasMessages),
		{ initialProps: { sessionId: "session-a", hasMessages: true } },
	);
	expect(result.current).toBe("expanded");

	rerender({ sessionId: "session-b", hasMessages: false });
	expect(result.current).toBe("initial");
	act(() => vi.runAllTimers());
	expect(result.current).toBe("initial");

	rerender({ sessionId: "session-b", hasMessages: true });
	expect(result.current).toBe("initial");
	act(() => vi.runAllTimers());
	expect(result.current).toBe("expanded");
});

it("快速连续切换会取消旧会话的扩大任务", () => {
	const { result, rerender } = renderHook(
		({ sessionId, hasMessages }: { sessionId: string; hasMessages: boolean }) =>
			useProgressiveMessageViewport(sessionId, hasMessages),
		{ initialProps: { sessionId: "session-a", hasMessages: true } },
	);

	rerender({ sessionId: "session-b", hasMessages: true });
	rerender({ sessionId: "session-c", hasMessages: false });
	act(() => vi.runAllTimers());

	expect(result.current).toBe("initial");
});
