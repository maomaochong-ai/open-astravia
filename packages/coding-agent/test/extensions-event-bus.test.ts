import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "../src/index.js";

describe("extension event bus public API", () => {
	it("preserves subscription, unsubscription and clear behavior", () => {
		const bus = createEventBus();
		const received: unknown[] = [];
		const unsubscribe = bus.on("status", (data) => {
			received.push(data);
		});

		bus.emit("status", 1);
		unsubscribe();
		bus.emit("status", 2);
		bus.on("status", (data) => {
			received.push(data);
		});
		bus.clear();
		bus.emit("status", 3);

		expect(received).toEqual([1]);
	});

	it("isolates a failing listener from later listeners", async () => {
		const bus = createEventBus();
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const received: unknown[] = [];
		bus.on("status", async () => {
			throw new Error("listener failed");
		});
		bus.on("status", (data) => {
			received.push(data);
		});

		bus.emit("status", "ready");
		await Promise.resolve();

		expect(received).toEqual(["ready"]);
		expect(error).toHaveBeenCalledWith("Event handler error (status):", expect.any(Error));
		error.mockRestore();
	});
});
