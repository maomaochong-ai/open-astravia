import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { CURRENT_TIME_TOOL_DESCRIPTION } from "./description.js";

export const CurrentTimeToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
});

export type CurrentTimeToolInput = Static<typeof CurrentTimeToolInputSchema>;

export interface CurrentTimeToolDetails {
	readonly timestamp: string;
}

export interface CurrentTimeToolOptions {
	readonly now?: () => Date;
}

export function createCurrentTimeTool(
	options: CurrentTimeToolOptions = {},
): RuntimeToolDefinition<CurrentTimeToolInput> {
	const now = options.now ?? (() => new Date());

	return {
		name: "current_time",
		label: "Current Time",
		description: CURRENT_TIME_TOOL_DESCRIPTION,
		inputSchema: CurrentTimeToolInputSchema,
		async execute(_request) {
			const timestamp = formatDateTime(now());
			return {
				content: [{ type: "text", text: timestamp }],
				details: {
					timestamp,
				} satisfies CurrentTimeToolDetails,
			};
		},
	};
}

function formatDateTime(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");
	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
