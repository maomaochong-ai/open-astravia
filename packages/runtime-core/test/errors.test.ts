import { describe, expect, it } from "vitest";
import { isSessionError, runtimeError } from "../src/errors.js";

describe("Runtime errors", () => {
	it("recognizes structured session failures independently of message text", () => {
		const error = runtimeError("SESSION_BUSY", "wording is not part of the contract", true);

		expect(isSessionError(error)).toBe(true);
		expect(error.code).toBe("SESSION_BUSY");
	});

	it("rejects incomplete lookalikes", () => {
		expect(isSessionError({ code: "SESSION_BUSY", message: "busy" })).toBe(false);
	});
});
