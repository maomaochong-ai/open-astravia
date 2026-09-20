import { describe, expect, it } from "vitest";
import { enqueueWrite } from "../src/git/runtime";

/** Resolve after `ms`, used to make overlap observable. */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("enqueueWrite", () => {
	it("runs queued writes one at a time, in order", async () => {
		const log: string[] = [];
		const task = (name: string, ms: number) => async () => {
			log.push(`${name}:start`);
			await sleep(ms);
			log.push(`${name}:end`);
			return name;
		};

		// The slow one is enqueued first: without serialization "b:start" would
		// land before "a:end".
		const results = await Promise.all([enqueueWrite(task("a", 20)), enqueueWrite(task("b", 0))]);

		expect(results).toEqual(["a", "b"]);
		expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
	});

	it("keeps draining after a write rejects", async () => {
		const failing = enqueueWrite(async () => {
			throw new Error("index.lock");
		});
		await expect(failing).rejects.toThrow("index.lock");

		await expect(enqueueWrite(async () => "next")).resolves.toBe("next");
	});
});
