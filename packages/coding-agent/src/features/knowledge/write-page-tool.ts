import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { WritePageResult } from "@vetta/runtime-knowledge";
import {
	type CodingToolRegistration,
	type CodingToolScope,
	ToolCallDescriptionSchema,
} from "@vetta/runtime-tools/coding";
import type { CodingAgentKnowledgeWriteOperations } from "./contracts.js";

export const CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_DESCRIPTION = `Write (create or update) a single wiki page in the LLM knowledge base at ~/.vetta/knowledges/.

This is the ONLY way to write wiki pages. It enforces the closed frontmatter schema (exactly: id, source, source_path, source_hash, tags, title, summary, created_at, updated_at, orphaned_at), assigns a stable page id, and refreshes the tags.json / manifest.json caches automatically. Do not hand-write wiki .md files with the generic write tool.

Upsert semantics:
- Provide \`id\` to update an existing page in place. The page keeps its id and created_at; updated_at is refreshed. Use this when reprocessing a changed source file (the poller resolves the old id for you).
- Omit \`id\`: if a page with the same \`source_hash\` already exists it is updated; otherwise a new page is created with a freshly assigned id.

Tree placement: \`path\` is relative to wiki/ and you choose it by topic/semantics (e.g. "产品/计费.md"), not by mirroring the raws layout. Updating an existing page with a different \`path\` moves it within the wiki tree (old file removed).

Cross-page references: put them in the body as [[page-id]] — never in frontmatter.

raw↔wiki is 1:1. One source raw file maps to exactly one wiki page.`;

export const CodingAgentKnowledgeWritePageToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	path: Type.String({
		description:
			'Target wiki page path relative to wiki/, e.g. "产品/计费.md". Organize the tree by topic/semantics, not by raw source layout. Updating an existing page with a new path moves it.',
	}),
	source: Type.String({
		description: "Source grouping name (the raws/<source>/ folder this page derives from).",
	}),
	source_path: Type.String({
		description: 'Original raw file path relative to raws/, e.g. "手册/api.md".',
	}),
	source_hash: Type.String({
		description: "Content hash of the source raw file (the page's primary identity).",
	}),
	tags: Type.Array(Type.String(), {
		maxItems: 5,
		description:
			"Flat string tags, at most 5. Reuse existing tags from kb_list_available_tags when semantically close; " +
			"Chinese for concepts/domains/topics, keep only proper nouns/tech stack in their original form (kubernetes, oauth). " +
			"Coarse, reusable dimensions only (domain/topic/doc-type); no version numbers, function names, one-off proper nouns, " +
			"or info already in title/summary.",
	}),
	title: Type.String({ description: "Page title." }),
	summary: Type.String({ description: "One-line summary, surfaced in indexes navigation." }),
	body: Type.String({
		description: "Page body markdown (without frontmatter). Cross-page links go here as [[page-id]].",
	}),
	id: Type.Optional(
		Type.String({
			description:
				"Existing page id to update in place (preserves id + created_at). Provide this when reprocessing a changed source; the poller resolves it. Omit to create a new page.",
		}),
	),
});

export type CodingAgentKnowledgeWritePageToolInput = Static<typeof CodingAgentKnowledgeWritePageToolInputSchema>;

export interface CodingAgentKnowledgeWritePageToolDetails extends WritePageResult {
	readonly absolutePath: string;
}

export interface CodingAgentKnowledgeWritePageToolOptions {
	readonly operations: CodingAgentKnowledgeWriteOperations;
	readonly modelOrder?: number;
	readonly now?: () => Date;
}

export const CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_SCOPES = [
	"kb-processing",
] as const satisfies readonly CodingToolScope[];
export const CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_REQUIRES = ["knowledge"] as const;
export const CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_CATEGORY = "kb-write";

export function createCodingAgentKnowledgeWritePageTool(
	options: CodingAgentKnowledgeWritePageToolOptions,
): RuntimeToolDefinition<CodingAgentKnowledgeWritePageToolInput> {
	const now = options.now ?? (() => new Date());
	return {
		name: "kb_write_page",
		label: "KB Write Page",
		description: CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_DESCRIPTION,
		inputSchema: CodingAgentKnowledgeWritePageToolInputSchema,
		async execute({ input }) {
			const result = await options.operations.write(input, now().toISOString());
			const absolutePath = options.operations.resolveAbsolutePath(result.path);
			const details: CodingAgentKnowledgeWritePageToolDetails = { ...result, absolutePath };
			const moved = result.movedFrom ? ` (moved from ${result.movedFrom})` : "";
			return {
				content: [
					{
						type: "text",
						text: `kb_write_page ${result.action} ok — id=${result.id}, path=${absolutePath}${moved}`,
					},
				],
				details,
			};
		},
	};
}

export function createCodingAgentKnowledgeWritePageToolRegistration(
	options: CodingAgentKnowledgeWritePageToolOptions,
): CodingToolRegistration<CodingAgentKnowledgeWritePageToolInput> {
	const tool = createCodingAgentKnowledgeWritePageTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_SCOPES,
		requires: CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_REQUIRES,
		modelOrder: options.modelOrder,
		category: CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_CATEGORY,
		sideEffect: "light",
	};
}
