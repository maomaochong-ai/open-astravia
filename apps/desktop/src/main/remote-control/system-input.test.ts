import { describe, expect, it } from "vitest";
import { createSystemInputAdapter } from "./system-input.js";

describe("createSystemInputAdapter", () => {
	it("keeps system input disabled unless explicitly granted", () => {
		const adapter = createSystemInputAdapter({ enabled: false });
		expect(adapter.supported).toBe(false);
		adapter.setEnabled(true);
		expect(() => adapter.apply({ type: "pointer.move", sequence: 1, x: 0.5, y: 0.5 })).not.toThrow();
	});
});
