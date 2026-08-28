import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { ToolCallDescriptionSchema } from "@vetta/runtime-tools/coding";
import type { ConversationScenario } from "../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../runtime-contracts/index.js";
import type { CodingAgentKnowledgeQueryOperations } from "./contracts.js";

export const CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_DESCRIPTION = `List every tag that exists in the knowledge base, each with the number of wiki pages carrying it (orphaned pages excluded), sorted by page count.

Use this to discover the available tag vocabulary before calling kb_filter_by_tags — it keeps your tag filters grounded in tags that actually exist instead of guessing. Takes no arguments.`;

export const CodingAgentKnowledgeListTagsToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
});

export type CodingAgentKnowledgeListTagsToolInput = Static<typeof CodingAgentKnowledgeListTagsToolInputSchema>;

export interface CodingAgentKnowledgeListTagsDetails {
	readonly tags: Awaited<ReturnType<CodingAgentKnowledgeQueryOperations["listAvailableTags"]>>;
}

export interface CodingAgentKnowledgeListTagsToolOptions {
	readonly operations: CodingAgentKnowledgeQueryOperations;
	readonly modelOrder?: number;
}

export const CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly ConversationScenario[];
export const CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_REQUIRES = ["knowledge"] as const;
export const CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_CATEGORY = "kb-read";

function createCodingAgentKnowledgeListTagsTool(
	options: CodingAgentKnowledgeListTagsToolOptions,
): RuntimeToolDefinition<CodingAgentKnowledgeListTagsToolInput> {
	return {
		name: "kb_list_available_tags",
		label: "KB List Tags",
		description: CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_DESCRIPTION,
		inputSchema: CodingAgentKnowledgeListTagsToolInputSchema,
		async execute() {
			const tags = await options.operations.listAvailableTags();
			const listing =
				tags.length === 0 ? "(no tags yet)" : tags.map(({ tag, count }) => `- ${tag} (${count})`).join("\n");
			return {
				content: [{ type: "text", text: `kb_list_available_tags — ${tags.length} tag(s):\n${listing}` }],
				details: { tags } satisfies CodingAgentKnowledgeListTagsDetails,
			};
		},
	};
}

export function createCodingAgentKnowledgeListTagsToolRegistration(
	options: CodingAgentKnowledgeListTagsToolOptions,
): CodingAgentRuntimeToolRegistration<CodingAgentKnowledgeListTagsToolInput> {
	const tool = createCodingAgentKnowledgeListTagsTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_SCOPES,
		requires: CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_REQUIRES,
		modelOrder: options.modelOrder,
		category: CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_CATEGORY,
		availabilityPolicy: "knowledge-runtime",
	};
}
