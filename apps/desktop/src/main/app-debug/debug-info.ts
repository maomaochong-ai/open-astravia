import { z } from "zod";
import type { DebugDefinition, JsonValue } from "./types.js";
import { DebugError } from "./types.js";

const inputSchema = z.object({}).strict();

function validateInput(input: unknown): JsonValue {
	const result = inputSchema.safeParse(input);
	if (!result.success) {
		throw new DebugError("DEBUG_INVALID_INPUT", "debug.info input must be an empty object.", {
			issues: result.error.issues.map((issue) => ({
				path: issue.path.join("."),
				message: issue.message,
			})),
		});
	}
	return result.data;
}

export function createDebugInfoDefinition(): DebugDefinition {
	return {
		id: "debug.info",
		category: "system",
		title: "Debug runtime information",
		summary: "Confirm that the development-only Vetta Debug namespace is available.",
		keywords: ["debug", "development", "runtime", "status"],
		inputSchema: { description: "An empty JSON object." },
		examples: [{ description: "Read Debug runtime information", input: {} }],
		validateInput,
		run: () => ({
			enabled: true,
			environment: "development",
			namespace: "debug",
		}),
	};
}
