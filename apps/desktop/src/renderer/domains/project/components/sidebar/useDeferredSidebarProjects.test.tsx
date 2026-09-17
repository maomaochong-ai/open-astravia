// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { SIDEBAR_DOCK_ANIMATION_MS } from "@vetta-org/theme-ui/layout";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 侧边栏展开的性能合同：项目/会话区不得在挂载的同步段渲染（那会吃掉展开动画的头几帧），
 * 必须等展开动画播完才补上；动画途中卸载则不再补。
 */

const { useDeferredSidebarProjects } = await import("./useDeferredSidebarProjects.js");

describe("useDeferredSidebarProjects", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("挂载同步段不放行项目区，展开动画播完后才放行", () => {
		const { result } = renderHook(() => useDeferredSidebarProjects());
		expect(result.current).toBe(false);

		act(() => {
			vi.advanceTimersByTime(SIDEBAR_DOCK_ANIMATION_MS - 1);
		});
		expect(result.current).toBe(false);

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(result.current).toBe(true);
	});

	it("动画途中卸载后不再放行（避免对已卸载子树 setState）", () => {
		const { result, unmount } = renderHook(() => useDeferredSidebarProjects());
		unmount();
		act(() => {
			vi.advanceTimersByTime(SIDEBAR_DOCK_ANIMATION_MS * 4);
		});
		expect(result.current).toBe(false);
	});
});
