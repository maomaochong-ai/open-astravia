import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { PROGRESS_TOOL_DESCRIPTION } from "./description.js";

export const ProgressToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	summary: Type.Optional(
		Type.String({
			description:
				"Completed-state title for the PREVIOUS stage, in the user's language (max 40 chars). Omit on the very first call.",
			maxLength: 40,
		}),
	),
	label: Type.Optional(
		Type.String({
			description:
				"In-progress title for the stage you are STARTING now, in the user's language (max 40 chars). Omit only when closing the final stage without starting a new one.",
			maxLength: 40,
		}),
	),
});

export type ProgressToolInput = Static<typeof ProgressToolInputSchema>;

export interface ProgressToolDetails {
	readonly label?: string;
	readonly summary?: string;
}

export function createProgressTool(): RuntimeToolDefinition<ProgressToolInput> {
	return {
		name: "progress",
		label: "Progress",
		description: PROGRESS_TOOL_DESCRIPTION,
		inputSchema: ProgressToolInputSchema,
		async execute({ input: { label, summary } }) {
			if (!label && !summary) {
				return {
					content: [
						{
							type: "text",
							text: 'Error: progress requires at least one of "label" (start a stage) or "summary" (close the previous stage).',
						},
					],
					details: {},
				};
			}
			return {
				content: [{ type: "text", text: "OK" }],
				details: { label, summary } satisfies ProgressToolDetails,
			};
		},
	};
}
