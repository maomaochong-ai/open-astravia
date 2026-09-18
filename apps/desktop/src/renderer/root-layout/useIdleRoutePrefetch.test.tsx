// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 空闲预取合同：能力页 chunk 不在挂载同步段求值（不与启动关键路径抢主线程），
 * 而是在空闲回调/兜底定时器触发后拉取；提前卸载则取消。
 */

const abilitiesEvaluated = vi.fn();
vi.mock("../domains/abilities/components/AbilitiesPage", () => {
	abilitiesEvaluated();
	return { AbilitiesPage: () => null };
});

const { useIdleRoutePrefetch } = await import("./useIdleRoutePrefetch.js");

describe("useIdleRoutePrefetch", () => {
	beforeEach(() => {
		abilitiesEvaluated.mockClear();
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("挂载同步段不求值能力页模块，空闲触发后才拉取", async () => {
		renderHook(() => useIdleRoutePrefetch());
		expect(abilitiesEvaluated).not.toHaveBeenCalled();

		// jsdom 无 requestIdleCallback，走 setTimeout 兜底路径。
		vi.advanceTimersByTime(3000);
		// 动态 import 是微任务，等它落地。
		await vi.waitFor(() => expect(abilitiesEvaluated).toHaveBeenCalledTimes(1));
	});

	it("空闲触发前卸载则取消预取", async () => {
		const { unmount } = renderHook(() => useIdleRoutePrefetch());
		unmount();
		vi.advanceTimersByTime(10_000);
		await Promise.resolve();
		expect(abilitiesEvaluated).not.toHaveBeenCalled();
	});
});
