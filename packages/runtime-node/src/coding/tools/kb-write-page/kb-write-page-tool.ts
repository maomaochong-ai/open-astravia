import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { KB_WRITE_PAGE_TOOL_DESCRIPTION } from "./description.js";

export const KbWritePageToolInputSchema = Type.Object({
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

export type KbWritePageToolInput = Static<typeof KbWritePageToolInputSchema>;

export interface KbWritePageRequest {
	readonly path: string;
	readonly source: string;
	readonly source_path: string;
	readonly source_hash: string;
	readonly tags: readonly string[];
	readonly title: string;
	readonly summary: string;
	readonly body: string;
	readonly id?: string;
}

export interface KbWritePageResult {
	readonly action: "create" | "update";
	readonly id: string;
	readonly path: string;
	readonly movedFrom?: string;
}

export interface KbWritePageOperations {
	write(request: KbWritePageRequest, now: string): Promise<KbWritePageResult>;
	resolveAbsolutePath(relativeWikiPath: string): string;
}

export interface KbWritePageToolDetails extends KbWritePageResult {
	readonly absolutePath: string;
}

export interface KbWritePageToolOptions {
	readonly operations: KbWritePageOperations;
	readonly now?: () => Date;
}

export function createKbWritePageTool(options: KbWritePageToolOptions): RuntimeToolDefinition<KbWritePageToolInput> {
	const now = options.now ?? (() => new Date());
	return {
		name: "kb_write_page",
		label: "KB Write Page",
		description: KB_WRITE_PAGE_TOOL_DESCRIPTION,
		inputSchema: KbWritePageToolInputSchema,
		async execute({ input }) {
			const result = await options.operations.write(input, now().toISOString());
			const absolutePath = options.operations.resolveAbsolutePath(result.path);
			const details: KbWritePageToolDetails = { ...result, absolutePath };
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
