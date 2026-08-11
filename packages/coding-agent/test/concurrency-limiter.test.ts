import { describe, expect, it } from "vitest";
import { createLimiter } from "../src/concurrency/index.js";

describe("createLimiter", () => {
	it("runs queued operations in FIFO order", async () => {
		const limiter = createLimiter(1);
		let releaseFirst: (() => void) | undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const events: string[] = [];

		const first = limiter.run(async () => {
			events.push("first:start");
			await firstGate;
			events.push("first:end");
		});
		const second = limiter.run(async () => {
			events.push("second:start");
		});

		await Promise.resolve();
		expect(events).toEqual(["first:start"]);
		releaseFirst?.();
		await Promise.all([first, second]);
		expect(events).toEqual(["first:start", "first:end", "second:start"]);
	});

	it("releases capacity when an operation rejects", async () => {
		const limiter = createLimiter(1);
		const failed = limiter.run(async () => {
			throw new Error("failed");
		});
		const next = limiter.run(async () => "completed");

		await expect(failed).rejects.toThrow("failed");
		await expect(next).resolves.toBe("completed");
	});
});
