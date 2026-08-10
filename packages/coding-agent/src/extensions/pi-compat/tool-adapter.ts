import type { TSchema } from "@sinclair/typebox";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";
import type { ToolDefinition } from "../tool-contracts.js";
import {
	type PiCompatibleToolDefinition,
	PiExtensionCompatibilityError,
	type PiExtensionCompatibilityFeature,
} from "./contracts.js";

export interface AdaptedPiTool {
	readonly definition: ToolDefinition;
	readonly features: readonly PiExtensionCompatibilityFeature[];
}

export function adaptPiToolDefinition(tool: PiCompatibleToolDefinition): AdaptedPiTool {
	if (tool.executionMode === "parallel") {
		throw new PiExtensionCompatibilityError(
			`tool:${tool.name}:executionMode`,
			`Pi tool '${tool.name}' requests parallel execution, which is not supported by this compatibility profile`,
		);
	}
	if (tool.constrainedSampling) {
		throw new PiExtensionCompatibilityError(
			`tool:${tool.name}:constrainedSampling`,
			`Pi tool '${tool.name}' requests constrained sampling, which is not supported by this compatibility profile`,
		);
	}

	const validateInput = compilePiValidator(tool);
	const features: PiExtensionCompatibilityFeature[] = [
		{
			feature: `tool:${tool.name}`,
			status: "adapted",
			detail: "TypeBox 1 schema is validated in the Pi compatibility boundary before native execution",
		},
		{
			feature: `tool:${tool.name}:context`,
			status: "host-dependent",
			detail:
				"Execution receives the shared Vetta context subset; Pi-only mode/scoped-model/trust fields are absent",
		},
	];
	if (tool.prepareArguments) {
		features.push({
			feature: `tool:${tool.name}:prepareArguments`,
			status: "adapted",
			detail: "Mapped to Vetta normalizeInput before compatibility schema validation",
		});
	}
	if (tool.promptSnippet || (tool.promptGuidelines?.length ?? 0) > 0) {
		features.push({
			feature: `tool:${tool.name}:prompt`,
			status: "adapted",
			detail: "Mapped to active-tool-only structured prompt contributions",
		});
	}
	if (tool.renderCall || tool.renderResult) {
		features.push({
			feature: `tool:${tool.name}:renderer`,
			status: "excluded",
			detail: "Pi TUI renderers are intentionally omitted",
		});
	}

	return {
		definition: {
			name: tool.name,
			label: tool.label,
			description: tool.description,
			parameters: structuredClone(tool.parameters) as unknown as TSchema,
			...(tool.prepareArguments ? { normalizeInput: tool.prepareArguments } : {}),
			validateInput,
			...(tool.promptSnippet || (tool.promptGuidelines?.length ?? 0) > 0
				? {
						prompt: {
							summary: tool.promptSnippet,
							guidelines: tool.promptGuidelines,
						},
					}
				: {}),
			async execute(toolCallId, params, signal, onUpdate, context) {
				return tool.execute(toolCallId, params, signal, onUpdate, context);
			},
		},
		features,
	};
}

function compilePiValidator(tool: PiCompatibleToolDefinition): (input: unknown) => Readonly<Record<string, unknown>> {
	const validator = Compile(tool.parameters);
	return (input) => {
		const converted = Value.Convert(tool.parameters, structuredClone(input));
		if (!validator.Check(converted)) {
			const errors = [...validator.Errors(converted)]
				.map((error) => `${error.instancePath || "/"}: ${error.message}`)
				.join("; ");
			throw new Error(`Validation failed for Pi tool '${tool.name}': ${errors || "unknown schema error"}`);
		}
		if (typeof converted !== "object" || converted === null || Array.isArray(converted)) {
			throw new Error(`Pi tool '${tool.name}' input schema must decode to an object`);
		}
		return converted as Readonly<Record<string, unknown>>;
	};
}
