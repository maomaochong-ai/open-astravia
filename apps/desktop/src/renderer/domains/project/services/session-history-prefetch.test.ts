import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	cancelSessionHistoryPrefetch,
	resetSessionHistoryPrefetchState,
	scheduleSessionHistoryPrefetch,
} from "./session-history-prefetch";

beforeEach(() => {
	vi.useFakeTimers();
	resetSessionHistoryPrefetchState();
});
afterEach(() => {
	vi.useRealTimers();
});

/**
 * 预取的纪律：停留够久才发、同一路径只发一次、鼠标划走就取消。
 * 违反任意一条都会变成「划过侧栏就偷偷读一堆大文件」。
 */
describe("会话历史预取", () => {
	it("停留够时间才触发一次读取", () => {
		const readHistory = vi.fn().mockResolvedValue(undefined);
		scheduleSessionHistoryPrefetch("/ws/a.jsonl", { readHistory });

		expect(readHistory).not.toHaveBeenCalled();
		vi.advanceTimersByTime(200);
		expect(readHistory).toHaveBeenCalledTimes(1);
		expect(readHistory).toHaveBeenCalledWith("/ws/a.jsonl");
	});

	it("鼠标划走就取消，不会偷偷读", () => {
		const readHistory = vi.fn().mockResolvedValue(undefined);
		scheduleSessionHistoryPrefetch("/ws/a.jsonl", { readHistory });
		cancelSessionHistoryPrefetch("/ws/a.jsonl");

		vi.advanceTimersByTime(500);
		expect(readHistory).not.toHaveBeenCalled();
	});

	it("同一路径只预取一次，来回悬停不重复读", () => {
		const readHistory = vi.fn().mockResolvedValue(undefined);
		scheduleSessionHistoryPrefetch("/ws/a.jsonl", { readHistory });
		vi.advanceTimersByTime(200);
		scheduleSessionHistoryPrefetch("/ws/a.jsonl", { readHistory });
		vi.advanceTimersByTime(200);

		expect(readHistory).toHaveBeenCalledTimes(1);
	});

	it("预取失败不抛错、也不反复重试", () => {
		const readHistory = vi.fn().mockRejectedValue(new Error("boom"));
		scheduleSessionHistoryPrefetch("/ws/broken.jsonl", { readHistory });
		vi.advanceTimersByTime(200);
		scheduleSessionHistoryPrefetch("/ws/broken.jsonl", { readHistory });
		vi.advanceTimersByTime(200);

		expect(readHistory).toHaveBeenCalledTimes(1);
	});

	it("没有 sessionPath 时什么都不做（新建会话行、组头等）", () => {
		const readHistory = vi.fn().mockResolvedValue(undefined);
		scheduleSessionHistoryPrefetch(undefined, { readHistory });
		vi.advanceTimersByTime(500);
		expect(readHistory).not.toHaveBeenCalled();
	});
});
