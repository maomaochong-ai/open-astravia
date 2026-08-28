import { describe, expect, it, vi } from "vitest";
import { startRendererAfterSessionPreparation } from "./renderer-startup.js";

describe("startRendererAfterSessionPreparation", () => {
	it("waits for development cache invalidation before starting renderer requests", async () => {
		const order: string[] = [];
		let finishCacheReset: (() => void) | undefined;
		const cacheResetGate = new Promise<void>((resolve) => {
			finishCacheReset = resolve;
		});
		const startRenderer = vi.fn(() => {
			order.push("renderer-started");
			return { id: 1 };
		});

		const startup = startRendererAfterSessionPreparation({
			resetDevelopmentCache: async () => {
				order.push("cache-reset-started");
				await cacheResetGate;
				order.push("cache-reset-finished");
			},
			startRenderer,
		});

		await Promise.resolve();
		expect(startRenderer).not.toHaveBeenCalled();
		finishCacheReset?.();

		await expect(startup).resolves.toEqual({ id: 1 });
		expect(order).toEqual(["cache-reset-started", "cache-reset-finished", "renderer-started"]);
	});

	it("starts immediately when packaged startup does not request a cache reset", async () => {
		const startRenderer = vi.fn(() => "renderer");

		await expect(startRendererAfterSessionPreparation({ startRenderer })).resolves.toBe("renderer");
		expect(startRenderer).toHaveBeenCalledOnce();
	});

	it("does not start the renderer when cache invalidation fails", async () => {
		const startRenderer = vi.fn();

		await expect(
			startRendererAfterSessionPreparation({
				resetDevelopmentCache: () => Promise.reject(new Error("cache reset failed")),
				startRenderer,
			}),
		).rejects.toThrow("cache reset failed");
		expect(startRenderer).not.toHaveBeenCalled();
	});
});
