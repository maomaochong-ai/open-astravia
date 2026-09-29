import { describe, expect, it } from "vitest";
import { inputBarContentWidthClassName } from "./input-bar-layout";

describe("inputBarContentWidthClassName", () => {
	it("matches an existing conversation composer to the message content column", () => {
		expect(inputBarContentWidthClassName("message")).toBe("max-w-3xl");
	});

	it("keeps the new-session composer aligned with its compact hero column", () => {
		expect(inputBarContentWidthClassName("compact")).toBe("max-w-2xl");
	});
});
