import { describe, expect, it, vi } from "vitest";
import { createMemorySampler, memorySamplerSnapshot } from "./memory-sampler";

function metric(type: string, workingSetKb: number, peakWorkingSetKb = workingSetKb) {
	return { type, memory: { workingSetSize: workingSetKb, peakWorkingSetSize: peakWorkingSetKb } };
}

describe("createMemorySampler", () => {
	it("采样一次记录各进程工作集与主进程 heap 到快照", () => {
		const warn = vi.fn();
		const sampler = createMemorySampler({
			log: { warn },
			intervalMs: 60_000,
			now: () => 1_000,
			getMetrics: () => [metric("Browser", 100 * 1024), metric("Renderer", 200 * 1024), metric("GPU", 50 * 1024)],
			readMainHeapBytes: () => 128 * 1024 * 1024,
		});

		const sample = sampler.sample();
		sampler.stop();

		expect(sample.totalWorkingSetMb).toBe(350);
		expect(sample.totalPeakWorkingSetMb).toBe(350);
		expect(sample.mainHeapMb).toBe(128);
		expect(sample.processes).toHaveLength(3);
		expect(memorySamplerSnapshot().at(-1)).toEqual(sample);
	});

	it("总工作集超阈值才记告警，未超不记", () => {
		const warn = vi.fn();
		const sampler = createMemorySampler({
			log: { warn },
			intervalMs: 60_000,
			warnThresholdMb: 1_000,
			now: () => 1_000,
			getMetrics: () => [metric("Browser", 500 * 1024), metric("Renderer", 600 * 1024)],
			readMainHeapBytes: () => 0,
		});

		sampler.sample();
		expect(warn).toHaveBeenCalledTimes(1);

		sampler.sample();
		expect(warn).toHaveBeenCalledTimes(2);
		sampler.stop();
	});

	it("低于阈值时保持静默", () => {
		const warn = vi.fn();
		const sampler = createMemorySampler({
			log: { warn },
			intervalMs: 60_000,
			warnThresholdMb: 8_192,
			now: () => 1_000,
			getMetrics: () => [metric("Browser", 100 * 1024)],
			readMainHeapBytes: () => 0,
		});

		sampler.sample();
		expect(warn).not.toHaveBeenCalled();
		sampler.stop();
	});
});
