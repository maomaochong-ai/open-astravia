import { describe, expect, it } from "vitest";
import { reactComponentStack, rememberReactComponentStack } from "./react-error-details";

describe("react-error-details", () => {
	it("returns the remembered component stack for the same error instance", () => {
		const error = new Error("Minified React error #185");
		rememberReactComponentStack(error, "    at QueueCardView");
		expect(reactComponentStack(error)).toContain("at QueueCardView");
	});

	it("keeps the first stack so a rethrow cannot erase the real culprit", () => {
		const error = new Error("Minified React error #185");
		rememberReactComponentStack(error, "    at First");
		rememberReactComponentStack(error, "    at Second");
		expect(reactComponentStack(error)).toContain("at First");
	});

	it("ignores primitives and missing stacks", () => {
		rememberReactComponentStack("boom", "    at Nothing");
		expect(reactComponentStack("boom")).toBeNull();
		const error = new Error("x");
		rememberReactComponentStack(error, undefined);
		expect(reactComponentStack(error)).toBeNull();
	});
});
