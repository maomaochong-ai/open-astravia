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

	it("treats reserved Node event names as ordinary channels", () => {
		const bus = createEventBus();
		const received: unknown[] = [];
		bus.on("error", (data) => received.push(data));
		bus.on("newListener", (data) => received.push(data));

		expect(() => bus.emit("error", "failure-data")).not.toThrow();
		bus.emit("newListener", "listener-data");

		expect(received).toEqual(["failure-data", "listener-data"]);
	});

	it("keeps duplicate subscriptions independent", () => {
		const bus = createEventBus();
		const received: unknown[] = [];
		const handler = (data: unknown) => received.push(data);
		const unsubscribeFirst = bus.on("status", handler);
		bus.on("status", handler);

		bus.emit("status", 1);
		unsubscribeFirst();
		bus.emit("status", 2);

		expect(received).toEqual([1, 1, 2]);
	});
});
