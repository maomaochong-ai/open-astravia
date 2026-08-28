import type { ModelCallFrameCompositionContext, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { TOOL_CALL_DESCRIPTION_TEXT } from "@vetta/runtime-tools";
import { describe, expect, it } from "vitest";
import { createCodingAgentToolProjectionPipeline } from "../src/tool-policy/tool-projection-policy.js";

describe("Coding Agent Tool projection policy", () => {
	it("injects the default call description and keeps it out of domain input", () => {
		const base = tool({ path: { type: "string" } });
		const projected = createCodingAgentToolProjectionPipeline()
			.projectTools(new Map([[base.name, base]]), frameContext())
			.get(base.name);
		if (!projected?.validateInput) throw new Error("Projected Tool is missing input validation");

		expect(projected.inputSchema).toMatchObject({
			properties: {
				description: {
					type: "string",
					maxLength: 100,
					description: TOOL_CALL_DESCRIPTION_TEXT,
				},
			},
		});
		expect(projected.validateInput({ path: "a.md", description: "Read the document" })).toEqual({ path: "a.md" });
	});

	it("adopts the legacy shared field but preserves a Tool-owned override", () => {
		const legacy = tool({
			path: { type: "string" },
			description: { type: "string", maxLength: 100, description: TOOL_CALL_DESCRIPTION_TEXT },
		});
		const custom = tool({
			path: { type: "string" },
			description: { type: "string", minLength: 20, description: "Document body" },
		});
		const pipeline = createCodingAgentToolProjectionPipeline();
		const projectedLegacy = pipeline.projectTools(new Map([[legacy.name, legacy]]), frameContext()).get(legacy.name);
		const projectedCustom = pipeline.projectTools(new Map([[custom.name, custom]]), frameContext()).get(custom.name);
		if (!projectedLegacy?.validateInput) throw new Error("Projected legacy Tool is missing input validation");

		expect(projectedLegacy.inputSchema).toBe(legacy.inputSchema);
		expect(projectedLegacy.validateInput({ path: "a.md", description: "Read it" })).toEqual({ path: "a.md" });
		expect(projectedCustom).toBe(custom);
	});

	it.each([
		{
			label: "an overlong call description",
			input: { path: "report.md", content: "private body", description: "x".repeat(101) },
			expectedIssue: "description: must NOT have more than 100 characters",
		},
		{
			label: "a missing domain field",
			input: { path: "report.md", description: "Write the report", privateContent: "private body" },
			expectedIssue: "content: must have required property 'content'",
		},
	])("returns a safe field-level error for $label", ({ input, expectedIssue }) => {
		const base = tool(
			{
				path: { type: "string" },
				content: { type: "string" },
			},
			["path", "content"],
		);
		const projected = createCodingAgentToolProjectionPipeline()
			.projectTools(new Map([[base.name, base]]), frameContext())
			.get(base.name);
		const validateInput = projected?.validateInput;
		if (!validateInput) throw new Error("Projected Tool is missing input validation");

		expect(() => validateInput(input)).toThrow(
			`Runtime Tool sample input rejected by projection coding-agent.call-description: ${expectedIssue}`,
		);
		try {
			validateInput(input);
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			if (!(error instanceof Error)) return;
			expect(error.message).not.toContain("private body");
			expect(error.message).not.toContain("Received arguments");
		}
	});
});

function tool(properties: Readonly<Record<string, unknown>>, required?: readonly string[]): RuntimeToolDefinition {
	return {
		name: "sample",
		label: "Sample",
		description: "Sample Tool",
		inputSchema: { type: "object", properties, ...(required ? { required } : {}) },
		execute: async () => ({ content: [] }),
	};
}

function frameContext(): ModelCallFrameCompositionContext {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		messages: [],
		signal: new AbortController().signal,
		frame: { instructions: [], tools: new Map() },
	};
}
