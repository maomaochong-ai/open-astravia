import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { validateWirePayload } from "../src/provider-kit/wire-validation.js";

const schema = Type.Object({ type: Type.Literal("delta"), index: Type.Number() });

describe("wire payload validation", () => {
	it("returns a typed valid payload", () => {
		const result = validateWirePayload(schema, { type: "delta", index: 1 }, { payloadType: "test event" });

		expect(result.index).toBe(1);
	});

	it("throws a structured response validation error", () => {
		expect(() =>
			validateWirePayload(schema, { type: "delta", index: "one" }, { provider: "test", payloadType: "test event" }),
		).toThrowError(
			expect.objectContaining({
				code: "AI_RESPONSE_VALIDATION_FAILED",
				provider: "test",
				metadata: {
					payloadType: "test event",
					errors: [expect.objectContaining({ path: "/index" })],
				},
			}),
		);
	});
});
