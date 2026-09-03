// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useDelayedUnmount } from "@vetta/theme-ui/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * useDelayedUnmount 是输入栏附件区 / 侧栏项目组共用的「CSS 折叠动画播完再卸载」
 * 原语：打开同步渲染，关闭延迟 delayMs 后卸载，期间重新打开要取消卸载。
 */
describe("useDelayedUnmount", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("打开时立即渲染", () => {
		const { result } = renderHook(({ open }) => useDelayedUnmount(open, 200), {
			initialProps: { open: true },
		});
		expect(result.current).toBe(true);
	});

	it("关闭后维持渲染 delayMs，随后卸载", () => {
		const { result, rerender } = renderHook(({ open }) => useDelayedUnmount(open, 200), {
			initialProps: { open: true },
		});
		rerender({ open: false });
		expect(result.current).toBe(true);
		act(() => void vi.advanceTimersByTime(199));
		expect(result.current).toBe(true);
		act(() => void vi.advanceTimersByTime(1));
		expect(result.current).toBe(false);
	});

	it("延迟期内重新打开会取消卸载", () => {
		const { result, rerender } = renderHook(({ open }) => useDelayedUnmount(open, 200), {
			initialProps: { open: true },
		});
		rerender({ open: false });
		act(() => void vi.advanceTimersByTime(100));
		rerender({ open: true });
		act(() => void vi.advanceTimersByTime(500));
		expect(result.current).toBe(true);
	});

	it("初始关闭时不渲染", () => {
		const { result } = renderHook(({ open }) => useDelayedUnmount(open, 200), {
			initialProps: { open: false },
		});
		expect(result.current).toBe(false);
	});
});
