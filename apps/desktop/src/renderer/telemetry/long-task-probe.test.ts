// @vitest-environment jsdom
/**
 * 渲染层 long task 探针：只在开发构建工作，观察超过阈值的 long task，
 * 记录 duration 与 attribution（脚本来源）。生产构建（import.meta.env.PROD）直接不装观察者。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PerformanceLongTaskTiming, PerformanceScriptTiming } from "./long-task-probe";
import { initializeLongTaskProbe } from "./long-task-probe";

// jsdom 没有 PerformanceObserver，测试里手工造一个可捕获回调的替身。
class FakePerformanceObserver {
	static instances: FakePerformanceObserver[] = [];
	readonly callback: PerformanceObserverCallback;
	// observe 里要写入，不能 readonly。
	options: PerformanceObserverInit;
	constructor(callback: PerformanceObserverCallback) {
		this.callback = callback;
		this.options = {};
		FakePerformanceObserver.instances.push(this);
	}
	observe(options: PerformanceObserverInit): void {
		this.options = options;
	}
	disconnect(): void {
		FakePerformanceObserver.instances = FakePerformanceObserver.instances.filter((instance) => instance !== this);
	}
	takeRecords(): PerformanceEntryList {
		return [];
	}
}

let originalObserver: typeof PerformanceObserver | undefined;

beforeEach(() => {
	originalObserver = (globalThis as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
	(globalThis as { PerformanceObserver: unknown }).PerformanceObserver =
		FakePerformanceObserver as unknown as typeof PerformanceObserver;
	FakePerformanceObserver.instances = [];
});

afterEach(() => {
	if (originalObserver !== undefined) {
		(globalThis as { PerformanceObserver: typeof PerformanceObserver }).PerformanceObserver = originalObserver;
	}
});

function longTask(durationMs: number, attribution?: PerformanceScriptTiming[]): PerformanceLongTaskTiming {
	return {
		name: "self",
		entryType: "longtask",
		startTime: 100,
		duration: durationMs,
		attribution: attribution as PerformanceScriptTiming[],
		toJSON: () => ({}),
	} as unknown as PerformanceLongTaskTiming;
}

describe("initializeLongTaskProbe", () => {
	it("观察 longtask 并记录超过阈值的项", () => {
		const logEvent = vi.fn();
		const dispose = initializeLongTaskProbe(logEvent, { thresholdMs: 50 });
		const instance = FakePerformanceObserver.instances[0];
		expect(instance?.options).toEqual({ type: "longtask", buffered: true });

		instance?.callback(
			{ getEntries: () => [longTask(120)] } as PerformanceObserverEntryList,
			{} as PerformanceObserver,
		);

		expect(logEvent).toHaveBeenCalledWith({
			durationMs: 120,
			startTimeMs: 100,
			attribution: undefined,
		});
		dispose();
		expect(FakePerformanceObserver.instances).toHaveLength(0);
	});

	it("低于阈值的 long task 不记录", () => {
		const logEvent = vi.fn();
		initializeLongTaskProbe(logEvent, { thresholdMs: 50 });
		const instance = FakePerformanceObserver.instances[0];

		instance?.callback(
			{ getEntries: () => [longTask(30)] } as PerformanceObserverEntryList,
			{} as PerformanceObserver,
		);

		expect(logEvent).not.toHaveBeenCalled();
	});

	it("带 attribution 时归约成「容器类型 → 名称 → 脚本」", () => {
		const logEvent = vi.fn();
		initializeLongTaskProbe(logEvent, { thresholdMs: 50 });
		const instance = FakePerformanceObserver.instances[0];
		const attribution = [
			{
				containerType: "window",
				containerName: "self",
				containerSrc: "https://app.example.com/assets/index.js",
			},
		];

		instance?.callback(
			{ getEntries: () => [longTask(80, attribution)] } as PerformanceObserverEntryList,
			{} as PerformanceObserver,
		);

		const record = logEvent.mock.calls[0]?.[0];
		expect(record.attribution).toBe("window → self → assets/index.js");
	});
});
