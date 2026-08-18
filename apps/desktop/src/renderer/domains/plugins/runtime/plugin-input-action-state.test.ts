import { describe, expect, it } from "vitest";
import { activateInputActionIds } from "./plugin-input-action-state";

describe("plugin input action state", () => {
	it("preserves the current Set when all requested actions are already active", () => {
		const current = new Set(["content-creation:toggle"]);

		expect(activateInputActionIds(current, ["content-creation:toggle", "content-creation:toggle"])).toBe(current);
	});

	it("creates one new Set when at least one action becomes active", () => {
		const current = new Set(["existing"]);

		const next = activateInputActionIds(current, ["existing", "new", "new"]);

		expect(next).not.toBe(current);
		expect([...next]).toEqual(["existing", "new"]);
		expect([...current]).toEqual(["existing"]);
	});
});
