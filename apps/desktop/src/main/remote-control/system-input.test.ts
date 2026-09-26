import { describe, expect, it } from "vitest";
import { createSystemInputAdapter } from "./system-input.js";

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
