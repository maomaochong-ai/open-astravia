import { describe, expect, it, vi } from "vitest";
import { createStartupTrace, STARTUP_SLOW_PHASE_MS, startupTraceSnapshot } from "./startup-trace.js";

function fakeLogger() {
	return { info: vi.fn(), warn: vi.fn() };
}

describe("createStartupTrace", () => {
	it("把每个阶段写成单行日志，带进程内绝对时间与阶段增量", () => {
		const log = fakeLogger();
		let clock = 10_000;
		const trace = createStartupTrace({ log, now: () => clock, originAt: 9_000 });

		clock = 10_400;
		const first = trace.mark("main-module-loaded");
		clock = 11_000;
		const second = trace.mark("app-ready");

		expect(first).toEqual({ label: "main-module-loaded", atMs: 1_400, sincePreviousMs: 1_400, slow: false });
		expect(second).toEqual({ label: "app-ready", atMs: 2_000, sincePreviousMs: 600, slow: false });
		expect(log.info.mock.calls).toEqual([
			["[startup] main-module-loaded at=1400ms delta=1400ms"],
			["[startup] app-ready at=2000ms delta=600ms"],
		]);
		expect(log.warn).not.toHaveBeenCalled();
	});

	it(`超过 ${STARTUP_SLOW_PHASE_MS}ms 的阶段升级为 warn`, () => {
		const log = fakeLogger();
		let clock = 0;
		const trace = createStartupTrace({ log, now: () => clock, originAt: 0 });

		clock = 200;
		trace.mark("diagnostics-installed");
		clock = 200 + STARTUP_SLOW_PHASE_MS;
		trace.mark("single-instance-acquired");

		expect(log.info).toHaveBeenCalledTimes(1);
		expect(log.warn).toHaveBeenCalledWith(
			`[startup] single-instance-acquired at=${STARTUP_SLOW_PHASE_MS + 200}ms delta=${STARTUP_SLOW_PHASE_MS}ms`,
		);
	});

	it("进程启动早于 JS 入口的时间也计入第一段", () => {
		const log = fakeLogger();
		// originAt 表示进程真正启动；第一个 mark 距离它很久，说明卡在 Electron 引导或单实例锁上。
		const trace = createStartupTrace({ log, now: () => 50_000, originAt: 44_000 });
		const mark = trace.mark("main-module-loaded");

		expect(mark.atMs).toBe(6_000);
		expect(mark.slow).toBe(true);
	});

	it("日志写入抛错不影响启动，也不中断后续打点", () => {
		const log = {
			info: vi.fn(() => {
				throw new Error("disk full");
			}),
			warn: vi.fn(),
		};
		let clock = 0;
		const trace = createStartupTrace({ log, now: () => clock, originAt: 0 });

		clock = 10;
		expect(() => trace.mark("first")).not.toThrow();
		clock = 20;
		expect(trace.mark("second").atMs).toBe(20);
		expect(trace.snapshot()).toHaveLength(2);
	});

	it("快照按顺序保留全部阶段，并同步到进程级快照供诊断包读取", () => {
		const log = fakeLogger();
		let clock = 0;
		const trace = createStartupTrace({ log, now: () => clock, originAt: 0 });

		for (const label of ["a", "b", "c"]) {
			clock += 5;
			trace.mark(label);
		}

		expect(trace.snapshot().map((mark) => mark.label)).toEqual(["a", "b", "c"]);
		expect(startupTraceSnapshot().map((mark) => mark.label)).toEqual(["a", "b", "c"]);
	});
});
