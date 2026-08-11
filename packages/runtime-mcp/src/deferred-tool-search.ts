import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { McpRuntimeToolDescriptor } from "./runtime-tool-synchronizer.js";

const toolSearchSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	query: Type.String({
		description:
			"Space-separated keywords matched (case-insensitive) against MCP tool names, server names, and descriptions.",
	}),
	max_results: Type.Optional(
		Type.Number({ description: "Maximum number of tools to activate in this call (default 5, max 10)." }),
	),
});

export type McpToolSearchInput = Static<typeof toolSearchSchema>;

export interface McpToolSearchResult {
	readonly activated: readonly McpRuntimeToolDescriptor[];
	readonly alreadyActive: readonly string[];
	readonly totalDeferred: number;
}

export interface McpToolSearchDetails extends McpToolSearchResult {
	readonly query: string;
}

export const MCP_TOOL_SEARCH_DESCRIPTION = `Search the deferred MCP tool index by keyword and activate matching tools.

When many MCP tools are configured, most are not loaded into your tool list up front — only an index of names and one-line descriptions appears in the system prompt. Call this tool with keywords (tool name fragments, server name, or capability words like "page", "database", "issue") to activate the best matches; their full schemas become callable from the next turn on.

Guidance:
- Prefer keywords copied from the MCP tool index in the system prompt.
- When the user names a specific MCP server or tool, search for that name.
- Activation persists for the rest of the session; there is no need to re-search for tools already activated.
- If nothing matches, retry with broader or different keywords before telling the user the capability is unavailable.`;

export function scoreMcpDeferredTools(
	query: string,
	entries: readonly McpRuntimeToolDescriptor[],
): readonly McpRuntimeToolDescriptor[] {
	const terms = query
		.toLowerCase()
		.split(/[\s,]+/)
		.filter((term) => term.length > 0);
	if (terms.length === 0) return [];
	const scored: Array<{ entry: McpRuntimeToolDescriptor; score: number }> = [];
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

export function createMcpToolSearchRuntimeTool(
	search: (query: string, maxResults: number) => McpToolSearchResult,
): RuntimeToolDefinition<McpToolSearchInput> {
	return {
		name: "tool_search",
		label: "Tool Search",
		description: MCP_TOOL_SEARCH_DESCRIPTION,
		inputSchema: toolSearchSchema,
		async execute(request) {
			const input = request.input;
			const maxResults = Math.min(Math.max(1, Math.floor(input.max_results ?? 5)), 10);
			const result = search(input.query, maxResults);
			const lines: string[] = [];
			if (result.activated.length > 0) {
				lines.push(`Activated ${result.activated.length} MCP tool(s) — callable from now on:`);
				for (const tool of result.activated) {
					lines.push(`- ${tool.name}: ${tool.description}`);
				}
			}
			if (result.alreadyActive.length > 0) {
				lines.push(`Already active: ${result.alreadyActive.join(", ")}`);
			}
			if (result.activated.length === 0 && result.alreadyActive.length === 0) {
				lines.push(
					`No MCP tools matched "${input.query}" (${result.totalDeferred} deferred tool(s) indexed). ` +
						"Try different keywords taken from the MCP tool list in the system prompt.",
				);
			}
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { query: input.query, ...result } satisfies McpToolSearchDetails,
			};
		},
	};
}
