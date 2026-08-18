import { describe, expect, it } from "vitest";
import { parseSessionTraceContext } from "./session-trace-context.js";

describe("parseSessionTraceContext", () => {
	it("accepts an omitted context or a UUID correlation id", () => {
		expect(parseSessionTraceContext(undefined)).toBeUndefined();
		expect(parseSessionTraceContext({ interactionId: "00000000-0000-4000-8000-000000000001" })).toEqual({
			interactionId: "00000000-0000-4000-8000-000000000001",
		});
	});

	it.each([null, "trace", {}, { interactionId: "not-a-uuid" }])("rejects invalid renderer input: %j", (value) => {
		expect(() => parseSessionTraceContext(value)).toThrow();
	});
});
