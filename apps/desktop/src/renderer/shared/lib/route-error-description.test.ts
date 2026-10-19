import { describe, expect, it } from "vitest";
import { describeRouteError } from "./route-error-description";

describe("describeRouteError", () => {
	it("recognises the update-depth loop React reports as #185", () => {
		expect(describeRouteError("Minified React error #185; visit https://react.dev/errors/185")).toEqual({
			code: 185,
			kind: "updateDepth",
		});
	});

	it("recognises a broken hooks order as #310", () => {
		expect(describeRouteError("Minified React error #310").kind).toBe("hooksOrder");
	});

	it("leaves non-React and unlisted React errors unclassified", () => {
		expect(describeRouteError("Something exploded")).toEqual({ code: null, kind: "unknown" });
		expect(describeRouteError("Minified React error #418").kind).toBe("unknown");
	});
});
