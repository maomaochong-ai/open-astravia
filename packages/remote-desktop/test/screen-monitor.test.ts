import { afterEach, describe, expect, it, vi } from "vitest";
import { watchScreenStream } from "../src/screen-monitor.js";
import type { ScreenStreamSample } from "../src/screen-stats.js";

afterEach(() => vi.useRealTimers());
describe("screen monitoring lifecycle", () => {
	it("samples each second, logs less often, and stops on unsubscribe", async () => {
		vi.useFakeTimers();
		let timestamp = 0;
		const sample = vi.fn(async () => {
			timestamp += 1000;
			return { timestamp };
		});
		const log = vi.fn();
		const stop = watchScreenStream(sample, log, vi.fn());
		await vi.advanceTimersByTimeAsync(6000);
		expect(sample).toHaveBeenCalledTimes(6);
		expect(log).toHaveBeenCalledTimes(2);
		stop();
		await vi.advanceTimersByTimeAsync(5000);
		expect(sample).toHaveBeenCalledTimes(6);
	});

	it("never overlaps slow reads or publishes a late sample after stopping", async () => {
		vi.useFakeTimers();
		let finish: (sample: ScreenStreamSample) => void = () => undefined;
		const sample = vi.fn(
			() =>
				new Promise<ScreenStreamSample>((resolve) => {
					finish = resolve;
				}),
		);
		const log = vi.fn();
		const stop = watchScreenStream(sample, log, vi.fn());
		await vi.advanceTimersByTimeAsync(10_000);
		expect(sample).toHaveBeenCalledOnce();
		stop();
		finish({ timestamp: 1000 });
		await vi.advanceTimersByTimeAsync(10_000);
		expect(log).not.toHaveBeenCalled();
		expect(sample).toHaveBeenCalledOnce();
	});

	it("reports a failed poll and continues sampling", async () => {
		vi.useFakeTimers();
		const error = new Error("stats failed");
		const sample = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ timestamp: 2000 });
		const log = vi.fn();
		const warn = vi.fn();
		const stop = watchScreenStream(sample, log, warn);
		await vi.advanceTimersByTimeAsync(2000);
		expect(warn).toHaveBeenCalledWith(error);
		expect(log).toHaveBeenCalledOnce();
		stop();
	});
});
