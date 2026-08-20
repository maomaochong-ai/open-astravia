// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	perfSessionSwitchBegin,
	perfSessionSwitchComplete,
	perfSessionSwitchMark,
	perfSessionSwitchRecordReactCommit,
} from "./perf-session-switch";

const interactionId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
	vi.useFakeTimers();
	localStorage.clear();
	vi.stubGlobal("crypto", { randomUUID: vi.fn(() => interactionId) });
});

afterEach(() => {
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("关闭诊断时只生成关联 id，不安装浏览器采集器", () => {
	const requestAnimationFrame = vi.fn();
	const PerformanceObserver = vi.fn();
	vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
	vi.stubGlobal("PerformanceObserver", PerformanceObserver);

	expect(perfSessionSwitchBegin("existing-session-open")).toBe(interactionId);
	expect(requestAnimationFrame).not.toHaveBeenCalled();
	expect(PerformanceObserver).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});

it("开启诊断后输出可检索的单行阶段与 long-task JSON", () => {
	localStorage.setItem("vetta-perf-session-switch", "1");
	let currentTime = 100;
	vi.spyOn(performance, "now").mockImplementation(() => currentTime);
	const frames: FrameRequestCallback[] = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	});

	let observeEntries: ((entries: PerformanceObserverEntryList) => void) | undefined;
	const disconnect = vi.fn();
	class FakePerformanceObserver {
		constructor(callback: PerformanceObserverCallback) {
			observeEntries = (entries) => callback(entries, this as unknown as PerformanceObserver);
		}

		observe(): void {}

		disconnect(): void {
			disconnect();
		}
	}
	vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
	const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

	const id = perfSessionSwitchBegin("existing-session-open");
	currentTime = 112;
	perfSessionSwitchMark("session-create-start", id);
	currentTime = 118;
	frames.shift()?.(currentTime);
	currentTime = 125;
	perfSessionSwitchRecordReactCommit("MessageList:initial-viewport", "update", 23.25, 40.04);
	observeEntries?.({
		getEntries: () => [{ startTime: 110, duration: 64 }] as PerformanceEntry[],
	} as PerformanceObserverEntryList);
	currentTime = 180;
	perfSessionSwitchComplete("completed", id);
	currentTime = 190;
	vi.advanceTimersByTime(1_000);

	expect(disconnect).toHaveBeenCalledOnce();
	expect(log).toHaveBeenCalledOnce();
	const line = String(log.mock.calls[0]?.[0]);
	expect(line.startsWith("[PERF-session-switch] ")).toBe(true);
	const payload = JSON.parse(line.slice("[PERF-session-switch] ".length));
	expect(payload).toMatchObject({
		interactionId,
		trigger: "existing-session-open",
		status: "completed",
		totalDurationMs: 80,
		longTasks: [{ startMs: 10, durationMs: 64 }],
		reactCommits: [
			{
				id: "MessageList:initial-viewport",
				phase: "update",
				atMs: 25,
				actualDurationMs: 23.3,
				baseDurationMs: 40,
			},
		],
		droppedReactCommits: 0,
	});
	expect(payload.marks).toEqual([
		{ label: "session-create-start", atMs: 12 },
		{ label: "frame#1", atMs: 18 },
		{ label: "completed", atMs: 80 },
	]);
});
