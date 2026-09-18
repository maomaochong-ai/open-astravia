import { describe, expect, it, vi } from "vitest";
import { createRetryableLoader } from "./loadNewSessionPage";

describe("new session page code loading", () => {
	it("shares an in-flight load and retries after an earlier prefetch fails", async () => {
		const load = vi.fn().mockRejectedValueOnce(new Error("chunk unavailable")).mockResolvedValue({ default: "page" });
		const retryable = createRetryableLoader(load);
		const first = retryable();
		expect(retryable()).toBe(first);
		await expect(first).rejects.toThrow("chunk unavailable");
		await expect(retryable()).resolves.toEqual({ default: "page" });
		expect(load).toHaveBeenCalledTimes(2);
	});
});
