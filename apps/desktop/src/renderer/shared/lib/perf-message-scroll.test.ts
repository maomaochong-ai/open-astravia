// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	perfMessageScrollAttach,
	perfMessageScrollRecordItemSize,
	perfMessageScrollRecordRange,
	perfMessageScrollRecordReactCommit,
	perfMessageScrollRecordRenderedItems,
	perfMessageScrollRecordTotalHeight,
} from "./perf-message-scroll";

beforeEach(() => {
	vi.useFakeTimers();
	localStorage.clear();
	sessionStorage.clear();
});

afterEach(() => {
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("关闭诊断时不监听滚动，也不安装性能观察器", () => {
	const scroller = document.createElement("div");
	const addEventListener = vi.spyOn(scroller, "addEventListener");
	const PerformanceObserver = vi.fn();
	vi.stubGlobal("PerformanceObserver", PerformanceObserver);

	const detach = perfMessageScrollAttach(scroller);
	detach();

	expect(addEventListener).not.toHaveBeenCalled();
	expect(PerformanceObserver).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});

it("一次滚动结束后持久化高度修正、渲染范围和 React 提交的关联报告", () => {
	localStorage.setItem("vetta-perf-message-scroll", "1");
	let currentTime = 100;
	vi.spyOn(performance, "now").mockImplementation(() => currentTime);
	vi.spyOn(performance, "mark").mockImplementation(() => ({}) as PerformanceMark);
	const frames: FrameRequestCallback[] = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	});
	vi.stubGlobal("cancelAnimationFrame", vi.fn());

	const observers: Array<{ callback: PerformanceObserverCallback; disconnect: ReturnType<typeof vi.fn> }> = [];
	class FakePerformanceObserver {
		readonly record: { callback: PerformanceObserverCallback; disconnect: ReturnType<typeof vi.fn> };

		constructor(callback: PerformanceObserverCallback) {
			this.record = { callback, disconnect: vi.fn() };
			observers.push(this.record);
		}

		observe(): void {}

		disconnect(): void {
			this.record.disconnect();
		}
	}
	vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
	const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
	const scroller = document.createElement("div");
	Object.defineProperty(scroller, "scrollTop", { configurable: true, writable: true, value: 320 });

	const detach = perfMessageScrollAttach(scroller);
	scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
	currentTime = 110;
	scroller.dispatchEvent(new Event("scroll"));
	currentTime = 116;
	frames.shift()?.(currentTime);
	perfMessageScrollRecordRange({ startIndex: 10, endIndex: 14 });
	perfMessageScrollRecordRenderedItems([
		{ data: "a", index: 10, offset: 1_000, size: 100 },
		{ data: "b", index: 11, offset: 1_100, size: 220 },
	]);
	perfMessageScrollRecordItemSize(10, 100, 180);
	perfMessageScrollRecordTotalHeight(8_000);
	perfMessageScrollRecordReactCommit("MessageScroll", "update", 24.26);
	observers[0]?.callback(
		{ getEntries: () => [{ startTime: 120, duration: 65 }] as PerformanceEntry[] } as PerformanceObserverEntryList,
		observers[0] as unknown as PerformanceObserver,
	);
	observers[1]?.callback(
		{
			getEntries: () =>
				[{ startTime: 125, duration: 0, value: 0.25, hadRecentInput: true }] as unknown as PerformanceEntry[],
		} as PerformanceObserverEntryList,
		observers[1] as unknown as PerformanceObserver,
	);

	currentTime = 1_700;
	vi.advanceTimersByTime(1_500);
	detach();

	expect(log).toHaveBeenCalledOnce();
	const line = String(log.mock.calls[0]?.[0]);
	expect(line.startsWith("[PERF-message-scroll] ")).toBe(true);
	const payload = JSON.parse(line.slice("[PERF-message-scroll] ".length));
	expect(payload).toMatchObject({
		version: 2,
		trigger: "wheel",
		summary: {
			wheelEvents: 1,
			scrollSamples: 1,
			rangeChanges: 1,
			renderedRangeChanges: 1,
			totalHeightChanges: 1,
			itemSizeCorrections: 1,
			largeItemSizeCorrections: 1,
			absoluteHeightCorrectionPx: 80,
			reactCommits: 1,
			reactCommitTotalMs: 24.3,
			reactCommitMaxMs: 24.3,
			longTasks: 1,
			longTaskTotalMs: 65,
			layoutShifts: 1,
			layoutShiftScore: 0.3,
		},
		droppedEvents: 0,
	});
	expect(payload.events).toEqual(
		expect.arrayContaining([expect.objectContaining({ type: "item-size", index: 10, correction: 80 })]),
	);
	expect(JSON.parse(sessionStorage.getItem("vetta-perf-message-scroll:last-report") ?? "null")).toEqual(payload);
	expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
});
