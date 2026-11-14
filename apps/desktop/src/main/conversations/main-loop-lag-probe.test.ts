import { describe, expect, it, vi } from "vitest";
import { startLoopLagProbe } from "./main-loop-lag-probe";

/**
 * 阻塞探针只在「主线程被同步工作按住」时报警。这两条边界决定它是否有用：
 * 正常抖动不能刷日志，真卡住时必须带上标签。
 */
describe("主线程阻塞探针", () => {
	it("醒来晚了超过阈值才报警，并带上最后一次标签", () => {
		vi.useFakeTimers();
		try {
			let clock = 0;
			const onLag = vi.fn();
			const probe = startLoopLagProbe({
				intervalMs: 100,
				lagThresholdMs: 300,
				now: () => clock,
				onLag,
			});

			probe.tag("viewer-history-read");
			// 正常醒来一次：时钟走 100 ms，没有阻塞。
			clock += 100;
			vi.advanceTimersByTime(100);
			expect(onLag).not.toHaveBeenCalled();

			// 这一次晚了 500 ms：应报警并带标签。
			clock += 600;
			vi.advanceTimersByTime(100);
			expect(onLag).toHaveBeenCalledWith(500, "viewer-history-read");

			// 标签只消费一次：下一次阻塞不带标签。
			clock += 600;
			vi.advanceTimersByTime(100);
			expect(onLag).toHaveBeenLastCalledWith(500, undefined);

			probe.stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it("stop 之后不再报警", () => {
		vi.useFakeTimers();
		try {
			let clock = 0;
			const onLag = vi.fn();
			const probe = startLoopLagProbe({ intervalMs: 100, lagThresholdMs: 100, now: () => clock, onLag });
			probe.stop();
			clock += 5000;
			vi.advanceTimersByTime(500);
			expect(onLag).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
