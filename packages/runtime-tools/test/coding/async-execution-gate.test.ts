import { describe, expect, it } from "vitest";
import { createAsyncExecutionGate } from "../../src/coding/index.js";

describe("createAsyncExecutionGate", () => {
	it("limits concurrency and starts queued operations in FIFO order", async () => {
		const gate = createAsyncExecutionGate(2);
		const first = deferred<void>();
		const second = deferred<void>();
		const third = deferred<void>();
		const started: number[] = [];
		let active = 0;
		let maxActive = 0;
		const run = (id: number, release: Promise<void>) =>
			gate.run(async () => {
				started.push(id);
				active += 1;
				maxActive = Math.max(maxActive, active);
				await release;
				active -= 1;
				return id;
			});

		const firstRun = run(1, first.promise);
		const secondRun = run(2, second.promise);
		const thirdRun = run(3, third.promise);
		expect(started).toEqual([1, 2]);

		second.resolve();
		await secondRun;
		await Promise.resolve();
		expect(started).toEqual([1, 2, 3]);
		first.resolve();
		third.resolve();
		expect(await Promise.all([firstRun, thirdRun])).toEqual([1, 3]);
		expect(maxActive).toBe(2);
	});

	it("releases capacity after rejection and clamps invalid limits to one", async () => {
		const gate = createAsyncExecutionGate(0);
		const release = deferred<void>();
		const started: string[] = [];
		const failed = gate.run(async () => {
			started.push("failed");
			await release.promise;
			throw new Error("failed operation");
		});
		const next = gate.run(async () => {
			started.push("next");
			return "done";
		});
		expect(started).toEqual(["failed"]);

		release.resolve();
		await expect(failed).rejects.toThrow("failed operation");
		expect(await next).toBe("done");
		expect(started).toEqual(["failed", "next"]);
	});
});

interface Deferred<T> {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve(value) {
			if (!resolvePromise) throw new Error("Deferred promise is not initialized");
			resolvePromise(value);
		},
	};
}
