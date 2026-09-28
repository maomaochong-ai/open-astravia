import { describe, expect, it } from "vitest";
import { createSystemInputAdapter, MacPointerState } from "./system-input.js";

describe("createSystemInputAdapter", () => {
	it("keeps system input disabled unless explicitly granted", () => {
		const adapter = createSystemInputAdapter({ enabled: false });
		expect(() => adapter.apply({ type: "pointer.move", sequence: 1, x: 0.5, y: 0.5 })).not.toThrow();
		if (process.platform === "win32") expect(adapter.supported).toBe(true);
		if (process.platform === "linux" && !process.env.DISPLAY) expect(adapter.supported).toBe(false);
	});

	it("still controls the machine when the host restarts and builds a new adapter", () => {
		const first = createSystemInputAdapter({ enabled: false });
		const second = createSystemInputAdapter({ enabled: false });
		expect(second.supported).toBe(first.supported);
		if (process.platform === "win32") expect(second.supported).toBe(true);
	});

	it("does not claim support on a platform without a native adapter", () => {
		const adapter = createSystemInputAdapter({ enabled: true });
		if (process.platform !== "win32" && process.platform !== "darwin" && process.platform !== "linux") {
			expect(adapter.supported).toBe(false);
		}
	});
});

describe("MacPointerState", () => {
	it("moves as a drag while a button is held, so the item under it comes along", () => {
		const pointer = new MacPointerState();
		expect(pointer.move(10, 10).eventType).toBe(5);
		pointer.press("left", "down", 10, 10, 0);
		expect(pointer.move(30, 5)).toEqual({ eventType: 6, button: 0, deltaX: 20, deltaY: -5 });
		expect(pointer.move(32, 5)).toEqual({ eventType: 6, button: 0, deltaX: 2, deltaY: 0 });
		pointer.press("left", "up", 50, 10, 900);
		expect(pointer.move(50, 10).eventType).toBe(5);
		pointer.press("right", "down", 10, 10, 2_000);
		expect(pointer.move(12, 10)).toEqual({ eventType: 7, button: 1, deltaX: 2, deltaY: 0 });
	});

	it("counts quick clicks in one place as a double-click", () => {
		const pointer = new MacPointerState();
		expect(pointer.press("left", "down", 100, 100, 0).clickCount).toBe(1);
		expect(pointer.press("left", "up", 100, 100, 60).clickCount).toBe(1);
		expect(pointer.press("left", "down", 102, 101, 250).clickCount).toBe(2);
		expect(pointer.press("left", "up", 102, 101, 300).clickCount).toBe(2);
		// Too slow: a new click.
		expect(pointer.press("left", "down", 100, 100, 1_200).clickCount).toBe(1);
		expect(pointer.press("left", "down", 300, 100, 1_300).clickCount).toBe(1);
	});
});
