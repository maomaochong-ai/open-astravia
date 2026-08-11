import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { KB_FILTER_BY_TAGS_TOOL_DESCRIPTION } from "./description.js";

export const KbFilterByTagsToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	all: Type.Optional(Type.Array(Type.String(), { description: "Intersection: page must contain ALL of these tags." })),
	any: Type.Optional(
		Type.Array(Type.String(), { description: "Union: page must contain AT LEAST ONE of these tags." }),
	),
	none: Type.Optional(Type.Array(Type.String(), { description: "Complement: page must contain NONE of these tags." })),
});

export type KbFilterByTagsToolInput = Static<typeof KbFilterByTagsToolInputSchema>;

export interface KbFilteredPage {
	readonly id: string;
	readonly path: string;
	readonly absolutePath: string;
	readonly title: string;
	readonly summary: string;
	readonly tags: readonly string[];
}

export interface KbFilterByTagsOperations {
	queryByTags(input: KbFilterByTagsToolInput): Promise<readonly KbFilteredPage[]>;
}

export interface KbFilterByTagsDetails {
	readonly count: number;
	readonly pages: readonly KbFilteredPage[];
}

export interface KbFilterByTagsToolOptions {
	readonly operations: KbFilterByTagsOperations;
}

export function createKbFilterByTagsTool(
	options: KbFilterByTagsToolOptions,
): RuntimeToolDefinition<KbFilterByTagsToolInput> {
	return {
		name: "kb_filter_by_tags",
		label: "KB Filter by Tags",
		description: KB_FILTER_BY_TAGS_TOOL_DESCRIPTION,
		inputSchema: KbFilterByTagsToolInputSchema,
		async execute({ input }) {
			const pages = await options.operations.queryByTags(input);
			const details: KbFilterByTagsDetails = { count: pages.length, pages };
			if (pages.length === 0) {
				const emptyHint =
					" Tags are only a shortcut — do NOT conclude the knowledge base lacks the answer yet. Keep exploring: " +
					"call kb_list_available_tags to see the real tag vocabulary and retry with different tags; read the curated " +
					"maps under indexes/; grep the full text of wiki/; browse the wiki/ tree and follow [[page-id]] links. " +
					"Only give up after these avenues come up empty.";
				return { content: [{ type: "text", text: `kb_filter_by_tags matched 0 pages.${emptyHint}` }], details };
			}
			const listing = pages
				.map((page) => `- [${page.id}] ${page.absolutePath} — ${page.title}: ${page.summary}`)
				.join("\n");
			const matchedHint =
				"\n\nIf these pages don't actually answer the question, keep exploring rather than settling: read indexes/, " +
				"grep wiki/ full text, retry with other tags (kb_list_available_tags), or follow [[page-id]] links from the pages above.";
			return {
				content: [
					{ type: "text", text: `kb_filter_by_tags matched ${pages.length} page(s):\n${listing}${matchedHint}` },
				],
				details,
			};
		},
	};
}
