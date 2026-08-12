import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { validateToolArguments } from "../src/utils/validation.js";

describe("tool argument validation", () => {
	it("reports only the selected discriminated operation branch", () => {
		const tool = {
			name: "edit",
			description: "Apply typed operations",
			parameters: Type.Object({
				operations: Type.Array(
					Type.Unsafe({
						oneOf: [
							Type.Object({ type: Type.Literal("add"), nodeId: Type.String() }, { additionalProperties: false }),
							Type.Object(
								{ type: Type.Literal("connect"), sourceNodeId: Type.String(), targetNodeId: Type.String() },
								{ additionalProperties: false },
							),
						],
					}),
				),
			}),
		};

		try {
			validateToolArguments(tool, {
				type: "toolCall",
				id: "call",
				name: "edit",
				arguments: { operations: [{ type: "connect", sourceNodeId: "source" }] },
			});
			expect.unreachable("expected validation failure");
		} catch (error) {
			const message = String(error);
			expect(message).toContain("must have required property 'targetNodeId'");
			expect(message).not.toContain("must have required property 'nodeId'");
			expect(message).not.toContain("must be equal to constant");
		}
	});

	it("names an unexpected property instead of returning an opaque additional-properties error", () => {
		const tool = {
			name: "edit",
			description: "Apply one operation",
			parameters: Type.Object({
				operation: Type.Object(
					{ type: Type.Literal("configure"), semanticRole: Type.Optional(Type.String()) },
					{ additionalProperties: false },
				),
			}),
		};

		expect(() =>
			validateToolArguments(tool, {
				type: "toolCall",
				id: "call",
				name: "edit",
				arguments: { operation: { type: "configure", role: "referenceImages" } },
			}),
		).toThrow("must NOT have additional properties 'role'");
	});
});
