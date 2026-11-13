import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmitCoalescer } from "./viewer-emit-coalescer";

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

/**
 * 会话文件订阅的行为约束：连续追写只投影一次，但最后一次变更必须发出去。
 * 这两条同时成立才算对——只防抖会停在半截历史，只限频会把主线程占满。
 */
describe("会话订阅的事件合并", () => {
	it("短时间内多次变更只投影一次", () => {
		const emit = vi.fn();
		const coalescer = createEmitCoalescer({ debounceMs: 200, minIntervalMs: 0, emit });

		coalescer.schedule();
		vi.advanceTimersByTime(50);
		coalescer.schedule();
		vi.advanceTimersByTime(50);
		coalescer.schedule();

		expect(emit).not.toHaveBeenCalled();
		vi.advanceTimersByTime(200);
		expect(emit).toHaveBeenCalledTimes(1);
	});

	it("持续写入时限频生效，但最后一次变更仍会在间隔后补发", () => {
		const emit = vi.fn();
		const coalescer = createEmitCoalescer({ debounceMs: 100, minIntervalMs: 400, emit });

		coalescer.schedule();
		vi.advanceTimersByTime(100);
		expect(emit).toHaveBeenCalledTimes(1);

		// 立刻又来一次：最小间隔未到，应被推迟而不是丢弃
		coalescer.schedule();
		vi.advanceTimersByTime(100);
		expect(emit).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(400);
		expect(emit).toHaveBeenCalledTimes(2);
	});

	it("释放后不再触发任何投影", () => {
		const emit = vi.fn();
		const coalescer = createEmitCoalescer({ debounceMs: 100, minIntervalMs: 0, emit });

		coalescer.schedule();
		coalescer.dispose();
		vi.advanceTimersByTime(1000);
		expect(emit).not.toHaveBeenCalled();
	});
});
