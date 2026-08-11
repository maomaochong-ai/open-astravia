import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { TOOL_SEARCH_TOOL_DESCRIPTION } from "./description.js";

export const ToolSearchToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	query: Type.String({
		description:
			"Space-separated keywords matched (case-insensitive) against MCP tool names, server names, and descriptions.",
	}),
	max_results: Type.Optional(
		Type.Number({ description: "Maximum number of tools to activate in this call (default 5, max 10)." }),
	),
});

export type ToolSearchToolInput = Static<typeof ToolSearchToolInputSchema>;

export interface DeferredToolIndexEntry {
	readonly name: string;
	readonly description: string;
}

export interface ToolSearchResult {
	readonly activated: readonly DeferredToolIndexEntry[];
	readonly alreadyActive: readonly string[];
	readonly totalDeferred: number;
}

export interface ToolSearchToolDetails extends ToolSearchResult {
	readonly query: string;
}

export interface ToolSearchToolOptions {
	readonly search: (query: string, maxResults: number) => ToolSearchResult;
}

export function scoreDeferredTools(
	query: string,
	entries: readonly DeferredToolIndexEntry[],
): readonly DeferredToolIndexEntry[] {
	const terms = query
		.toLowerCase()
		.split(/[\s,]+/)
		.filter((term) => term.length > 0);
	if (terms.length === 0) return [];
	const scored: Array<{ entry: DeferredToolIndexEntry; score: number }> = [];
	for (const entry of entries) {
		const name = entry.name.toLowerCase();
		const description = entry.description.toLowerCase();
		let score = 0;
		for (const term of terms) {
			if (name.includes(term)) score += 3;
			if (description.includes(term)) score += 1;
		}
		if (score > 0) scored.push({ entry, score });
	}
	scored.sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name));
	return scored.map(({ entry }) => entry);
}

export function createToolSearchTool(options: ToolSearchToolOptions): RuntimeToolDefinition<ToolSearchToolInput> {
	return {
		name: "tool_search",
		label: "Tool Search",
		description: TOOL_SEARCH_TOOL_DESCRIPTION,
		inputSchema: ToolSearchToolInputSchema,
		async execute({ input }) {
			const maxResults = Math.min(Math.max(1, Math.floor(input.max_results ?? 5)), 10);
			const result = options.search(input.query, maxResults);
			const lines: string[] = [];
			if (result.activated.length > 0) {
				lines.push(`Activated ${result.activated.length} MCP tool(s) — callable from now on:`);
				for (const tool of result.activated) lines.push(`- ${tool.name}: ${tool.description}`);
			}
			if (result.alreadyActive.length > 0) {
				lines.push(`Already active (call directly, do not search again): ${result.alreadyActive.join(", ")}`);
			}
			if (result.activated.length === 0 && result.alreadyActive.length === 0) {
				lines.push(
					`No MCP tools matched "${input.query}" (${result.totalDeferred} deferred tool(s) indexed). ` +
						"Try different keywords taken from the MCP tool list in the system prompt.",
				);
			}
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { query: input.query, ...result } satisfies ToolSearchToolDetails,
			};
		},
	};
}
