import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { MEMORY_TOOL_DESCRIPTION } from "./description.js";

export const MemoryToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	action: Type.Union([Type.Literal("add"), Type.Literal("replace"), Type.Literal("remove")], {
		description: "add = append a new memory entry; replace = swap an existing entry; remove = delete an entry.",
	}),
	content: Type.Optional(
		Type.String({
			description: "The memory entry text. Required for add and replace. One self-contained fact per entry.",
		}),
	),
	match: Type.Optional(
		Type.String({
			description: "A substring identifying the existing entry to replace/remove. Required for replace and remove.",
		}),
	),
});

export type MemoryToolInput = Static<typeof MemoryToolInputSchema>;
export type MemoryToolAction = MemoryToolInput["action"];

export interface MemoryToolState {
	readonly entries: readonly string[];
	readonly chars: number;
	readonly limit: number;
}

export interface MemoryToolOperations {
	apply(action: MemoryToolAction, input: { readonly content?: string; readonly match?: string }): MemoryToolState;
}

export interface MemoryToolDetails {
	readonly action: MemoryToolAction;
	readonly entryCount: number;
	readonly chars: number;
	readonly limit: number;
}

export interface MemoryToolOptions {
	readonly operations: MemoryToolOperations;
}

export function createMemoryTool(options: MemoryToolOptions): RuntimeToolDefinition<MemoryToolInput> {
	return {
		name: "memory",
		label: "Memory",
		description: MEMORY_TOOL_DESCRIPTION,
		inputSchema: MemoryToolInputSchema,
		async execute({ input }) {
			let state: MemoryToolState;
			try {
				state = options.operations.apply(input.action, { content: input.content, match: input.match });
			} catch (error) {
				throw new Error(error instanceof Error ? error.message : String(error));
			}
			const details: MemoryToolDetails = {
				action: input.action,
				entryCount: state.entries.length,
				chars: state.chars,
				limit: state.limit,
			};
			const listing =
				state.entries.length === 0
					? "(empty)"
					: state.entries.map((entry, index) => `${index + 1}. ${entry}`).join("\n");
			const summary =
				`memory ${input.action} ok — ${state.entries.length} entr${state.entries.length === 1 ? "y" : "ies"}, ` +
				`${state.chars}/${state.limit} chars.\n\nCurrent memory:\n${listing}`;
			return { content: [{ type: "text", text: summary }], details };
		},
	};
}
