import { describe, expect, it } from "vitest";
import { BrowserAutomationError } from "./contracts.js";

describe("BrowserAutomationError", () => {
	it("captures code and message", () => {
		const err = new BrowserAutomationError("policy_escape", "Host not allowed");
		expect(err.code).toBe("policy_escape");
		expect(err.message).toBe("Host not allowed");
		expect(err.name).toBe("BrowserAutomationError");
	});

	it("supports cause", () => {
		const cause = new Error("underlying");
		const err = new BrowserAutomationError("spawn_failed", "Spawn failed", { cause });
		expect(err.cause).toBe(cause);
	});

	it("preserves instanceof through Object.setPrototypeOf", () => {
		const err = new BrowserAutomationError("x", "y");
		expect(err).toBeInstanceOf(BrowserAutomationError);
		expect(err).toBeInstanceOf(Error);
	});
});
