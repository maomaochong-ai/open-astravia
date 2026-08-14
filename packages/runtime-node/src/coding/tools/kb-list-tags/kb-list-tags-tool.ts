import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { KB_LIST_TAGS_TOOL_DESCRIPTION } from "./description.js";

export const KbListTagsToolInputSchema = Type.Object({ description: ToolCallDescriptionSchema });
export type KbListTagsToolInput = Static<typeof KbListTagsToolInputSchema>;

export interface KbTagCount {
	readonly tag: string;
	readonly count: number;
}

export interface KbListTagsOperations {
	listAvailableTags(): Promise<readonly KbTagCount[]>;
}

export interface KbListTagsDetails {
	readonly tags: readonly KbTagCount[];
}

export interface KbListTagsToolOptions {
	readonly operations: KbListTagsOperations;
}

export function createKbListTagsTool(options: KbListTagsToolOptions): RuntimeToolDefinition<KbListTagsToolInput> {
	return {
		name: "kb_list_available_tags",
		label: "KB List Tags",
		description: KB_LIST_TAGS_TOOL_DESCRIPTION,
		inputSchema: KbListTagsToolInputSchema,
		async execute() {
			const tags = await options.operations.listAvailableTags();
			const listing =
				tags.length === 0 ? "(no tags yet)" : tags.map(({ tag, count }) => `- ${tag} (${count})`).join("\n");
			return {
				content: [{ type: "text", text: `kb_list_available_tags — ${tags.length} tag(s):\n${listing}` }],
				details: { tags } satisfies KbListTagsDetails,
			};
		},
	};
}
