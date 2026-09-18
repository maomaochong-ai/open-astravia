// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 空闲预取合同：挂载后开始分片调度；卸载则取消后续 chunk。
 */

const { prefetchIdleRoutes, cancelIdlePrefetch } = vi.hoisted(() => {
	const cancelIdlePrefetch = vi.fn();
	return {
		cancelIdlePrefetch,
		prefetchIdleRoutes: vi.fn(() => cancelIdlePrefetch),
	};
});
vi.mock("./route-prefetch", () => ({
	prefetchIdleRoutes: () => prefetchIdleRoutes(),
}));

const { useIdleRoutePrefetch } = await import("./useIdleRoutePrefetch.js");

describe("useIdleRoutePrefetch", () => {
	beforeEach(() => {
		prefetchIdleRoutes.mockClear();
		cancelIdlePrefetch.mockClear();
	});

	it("挂载后开始空闲预取，不在渲染同步段调用", () => {
		prefetchIdleRoutes.mockClear();
		const { unmount } = renderHook(() => useIdleRoutePrefetch());
		expect(prefetchIdleRoutes).toHaveBeenCalledTimes(1);
		unmount();
		expect(cancelIdlePrefetch).toHaveBeenCalledTimes(1);
	});

	it("卸载则取消后续预取切片", () => {
		const { unmount } = renderHook(() => useIdleRoutePrefetch());
		unmount();
		expect(cancelIdlePrefetch).toHaveBeenCalledTimes(1);
	});
});
