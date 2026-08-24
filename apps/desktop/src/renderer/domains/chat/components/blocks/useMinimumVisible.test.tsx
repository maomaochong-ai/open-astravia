// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useMinimumVisible } from "@vetta/theme-ui/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「正在思考」卡片的最短可见时长原语：模型吐字太快时思考不该一闪而过，
 * 停留期间接上新一段思考要无缝续上，而不是收起再重新出现。
 */
describe("useMinimumVisible", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("active 时立即可见", () => {
		const { result } = renderHook(({ active }) => useMinimumVisible(active, 1500), {
			initialProps: { active: true },
		});

		expect(result.current).toBe(true);
	});

	it("瞬间结束时补足最短可见时长再收起", () => {
		const { result, rerender } = renderHook(({ active }) => useMinimumVisible(active, 1500), {
			initialProps: { active: true },
		});

		rerender({ active: false });
		expect(result.current).toBe(true);
		act(() => void vi.advanceTimersByTime(1499));
		expect(result.current).toBe(true);
		act(() => void vi.advanceTimersByTime(1));
		expect(result.current).toBe(false);
	});

	it("已经显示够久时结束就立刻收起", () => {
		const { result, rerender } = renderHook(({ active }) => useMinimumVisible(active, 1500), {
			initialProps: { active: true },
		});

		act(() => void vi.advanceTimersByTime(2000));
		rerender({ active: false });
		expect(result.current).toBe(false);
	});

	it("停留期间接上新一段时保持可见，并重新计一次最短时长", () => {
		const { result, rerender } = renderHook(({ active }) => useMinimumVisible(active, 1500), {
			initialProps: { active: true },
		});

		rerender({ active: false });
		act(() => void vi.advanceTimersByTime(800));
		rerender({ active: true });
		expect(result.current).toBe(true);

		// 第二段随即结束：计时从接力那一刻重新起头，而不是沿用第一段的余额。
		rerender({ active: false });
		act(() => void vi.advanceTimersByTime(1499));
		expect(result.current).toBe(true);
		act(() => void vi.advanceTimersByTime(1));
		expect(result.current).toBe(false);
	});

	it("初始未开始时不可见", () => {
		const { result } = renderHook(({ active }) => useMinimumVisible(active, 1500), {
			initialProps: { active: false },
		});

		expect(result.current).toBe(false);
	});
});
