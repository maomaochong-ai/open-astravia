import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { ToolCallDescriptionSchema } from "@vetta/runtime-tools/coding";
import type { ConversationScenario } from "../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";
import type { CodingAgentKnowledgePage, CodingAgentKnowledgeQueryOperations } from "./contracts.js";

export const CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_DESCRIPTION = `Filter knowledge base wiki pages by their tags, using set algebra.

- all: intersection — page must contain ALL of these tags (AND)
- any: union — page must contain AT LEAST ONE of these tags (OR)
- none: complement — page must contain NONE of these tags (NOT), relative to the whole base

The three clauses combine with AND. An omitted/empty clause adds no constraint; an empty query returns all live pages. Orphaned pages are excluded. Returns each matched page's id, absolute file path, title and summary so you can drill down. Pass the absolute path directly to the read tool. If you don't know which tags exist, call kb_list_available_tags first.

This is a convenience shortcut for multi-dimensional retrieval, NOT the only path. You can also navigate the curated maps under indexes/, or progressively explore the wiki/ tree (read pages, follow [[page-id]] links, grep full text).`;

export const CodingAgentKnowledgeFilterByTagsToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	all: Type.Optional(Type.Array(Type.String(), { description: "Intersection: page must contain ALL of these tags." })),
	any: Type.Optional(
		Type.Array(Type.String(), { description: "Union: page must contain AT LEAST ONE of these tags." }),
	),
	none: Type.Optional(Type.Array(Type.String(), { description: "Complement: page must contain NONE of these tags." })),
});

export type CodingAgentKnowledgeFilterByTagsToolInput = Static<typeof CodingAgentKnowledgeFilterByTagsToolInputSchema>;

export interface CodingAgentKnowledgeFilterByTagsDetails {
	readonly count: number;
	readonly pages: readonly CodingAgentKnowledgePage[];
}

export interface CodingAgentKnowledgeFilterByTagsToolOptions {
	readonly operations: CodingAgentKnowledgeQueryOperations;
	readonly modelOrder?: number;
}

export const CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly ConversationScenario[];
export const CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_REQUIRES = ["knowledge"] as const;
export const CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_CATEGORY = "kb-read";

function createCodingAgentKnowledgeFilterByTagsTool(
	options: CodingAgentKnowledgeFilterByTagsToolOptions,
): RuntimeToolDefinition<CodingAgentKnowledgeFilterByTagsToolInput> {
	return {
		name: "kb_filter_by_tags",
		label: "KB Filter by Tags",
		description: CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_DESCRIPTION,
		inputSchema: CodingAgentKnowledgeFilterByTagsToolInputSchema,
		async execute({ input }) {
			const pages = await options.operations.queryByTags(input);
			const details: CodingAgentKnowledgeFilterByTagsDetails = { count: pages.length, pages };
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

export function createCodingAgentKnowledgeFilterByTagsToolRegistration(
	options: CodingAgentKnowledgeFilterByTagsToolOptions,
): CodingAgentRuntimeToolRegistration<CodingAgentKnowledgeFilterByTagsToolInput> {
	const tool = createCodingAgentKnowledgeFilterByTagsTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_SCOPES,
		requires: CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_REQUIRES,
		modelOrder: options.modelOrder,
		category: CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_CATEGORY,
		availabilityPolicy: "knowledge-runtime",
	};
}
