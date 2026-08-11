import { describe, expect, it, vi } from "vitest";
import { RetryableCleanup } from "../../src/runtime-host/retryable-cleanup.js";

describe("RetryableCleanup", () => {
	it("attempts every phase, shares concurrent runs and retries only failed tasks", async () => {
		let releaseFirstAttempt: (() => void) | undefined;
		const firstAttemptBlocked = new Promise<void>((resolve) => {
			releaseFirstAttempt = resolve;
		});
		let flakyAttempts = 0;
		const order: string[] = [];
		const cleanup = new RetryableCleanup();
		cleanup.add({
			id: "flaky",
			phase: 0,
			cleanup: vi.fn(async () => {
				order.push("flaky");
				flakyAttempts += 1;
				if (flakyAttempts === 1) {
					await firstAttemptBlocked;
					throw new Error("flaky cleanup failed");
				}
			}),
		});
		const stable = vi.fn(async () => {
			order.push("stable");
		});
		const later = vi.fn(async () => {
			order.push("later");
		});
		cleanup.add({ id: "stable", phase: 0, cleanup: stable });
		cleanup.add({ id: "later", phase: 1, cleanup: later });

		const first = cleanup.run("cleanup failed");
		const concurrent = cleanup.run("cleanup failed");
		releaseFirstAttempt?.();

		await expect(first).rejects.toThrow("flaky cleanup failed");
		await expect(concurrent).rejects.toThrow("flaky cleanup failed");
		expect(order).toEqual(["flaky", "stable", "later"]);
		expect(stable).toHaveBeenCalledOnce();
		expect(later).toHaveBeenCalledOnce();

		await expect(cleanup.run("cleanup failed")).resolves.toBeUndefined();
		expect(order).toEqual(["flaky", "stable", "later", "flaky"]);
		expect(stable).toHaveBeenCalledOnce();
		expect(later).toHaveBeenCalledOnce();
		await expect(cleanup.run("cleanup failed")).resolves.toBeUndefined();
		expect(flakyAttempts).toBe(2);
	});
});
