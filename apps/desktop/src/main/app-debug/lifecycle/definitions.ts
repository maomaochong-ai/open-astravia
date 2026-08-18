import { z } from "zod";
import type { DebugDefinition, JsonValue } from "../types.js";
import { DebugError } from "../types.js";

const QUIT_DELAY_MS = 75;
const inputSchema = z.object({}).strict();

function validateInput(input: unknown): JsonValue {
	const result = inputSchema.safeParse(input);
	if (!result.success) {
		throw new DebugError("DEBUG_INVALID_INPUT", "lifecycle.quit input must be an empty object.", {
			issues: result.error.issues.map((issue) => ({
				path: issue.path.join("."),
				message: issue.message,
			})),
		});
	}
	return result.data;
}

export function createLifecycleDebugDefinitions(requestQuit: () => void): DebugDefinition[] {
	return [
		{
			id: "lifecycle.quit",
			category: "lifecycle",
			title: "Quit the development Desktop process",
			summary: "Schedule Electron app.quit() after the Debug RPC response has had time to flush.",
			keywords: ["lifecycle", "quit", "shutdown", "cleanup", "development"],
			inputSchema: { description: "An empty JSON object." },
			examples: [{ description: "Gracefully quit the development Desktop process", input: {} }],
			validateInput,
			run: () => {
				const timer = setTimeout(requestQuit, QUIT_DELAY_MS);
				timer.unref?.();
				return { status: "scheduled", delayMs: QUIT_DELAY_MS };
			},
		},
	];
}
