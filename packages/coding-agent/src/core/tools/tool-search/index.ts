import { type Static, Type } from "@sinclair/typebox";
import type { CodingAgentTool } from "../../session/tool-scope.js";
import { loadToolDescription } from "../description.js";
import { toolCallDescriptionSchema } from "../tool-call-description.js";

const toolSearchSchema = Type.Object({
	description: toolCallDescriptionSchema,
	query: Type.String({
		description:
			"Space-separated keywords matched (case-insensitive) against MCP tool names, server names, and descriptions.",
	}),
	max_results: Type.Optional(
		Type.Number({ description: "Maximum number of tools to activate in this call (default 5, max 10)." }),
	),
});

export type ToolSearchToolInput = Static<typeof toolSearchSchema>;

/** 可检索的 deferred 工具索引条目。 */
export interface DeferredToolIndexEntry {
	name: string;
	description: string;
}

/** 宿主执行检索+激活后的结果。 */
export interface ToolSearchResult {
	/** 本次新激活的工具（下一轮起可调用）。 */
	activated: DeferredToolIndexEntry[];
	/** 命中但已处于激活态的工具名。 */
	alreadyActive: string[];
	/** 当前 deferred 索引的工具总数。 */
	totalDeferred: number;
}

export interface ToolSearchToolDetails extends ToolSearchResult {
	query: string;
}

export interface ToolSearchToolOptions {
	/** 检索并激活 deferred MCP 工具（宿主实现，一般绑定 runtime-manager）。 */
	search: (query: string, maxResults: number) => ToolSearchResult;
}

/**
 * 关键词打分：query 拆词后对 name/description 逐词匹配。
 * - 工具名包含词 ×3（工具名里通常带 server 前缀，server 名命中同样走这条）
 * - 描述包含词 ×1
 * 返回按分数降序的索引条目（0 分不返回）。纯函数，便于单测。
 */
export function scoreDeferredTools(query: string, entries: DeferredToolIndexEntry[]): DeferredToolIndexEntry[] {
	const terms = query
		.toLowerCase()
		.split(/[\s,]+/)
		.filter((t) => t.length > 0);
	if (terms.length === 0) return [];
	const scored: Array<{ entry: DeferredToolIndexEntry; score: number }> = [];
	for (const entry of entries) {
		const name = entry.name.toLowerCase();
		const desc = entry.description.toLowerCase();
		let score = 0;
		for (const term of terms) {
			if (name.includes(term)) score += 3;
			if (desc.includes(term)) score += 1;
		}
		if (score > 0) scored.push({ entry, score });
	}
	scored.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
	return scored.map((s) => s.entry);
}

export function createToolSearchTool(
	options: ToolSearchToolOptions,
): CodingAgentTool<typeof toolSearchSchema, ToolSearchToolDetails> {
	const fallbackDescription =
		"Search the deferred MCP tool index by keyword and activate the matches so they become callable in subsequent turns.";
	const description = loadToolDescription("tool-search", fallbackDescription);

	return {
		name: "tool_search",
		label: "Tool Search",
		// 注册但不默认激活：仅在 MCP deferred 模式下由 runtime-manager 强制加入激活集。
		scope_use: [],
		category: "core",
		description,
		parameters: toolSearchSchema,
		execute: async (_toolCallId, input) => {
			const maxResults = Math.min(Math.max(1, Math.floor(input.max_results ?? 5)), 10);
			const result = options.search(input.query, maxResults);
			const lines: string[] = [];
			if (result.activated.length > 0) {
				lines.push(`Activated ${result.activated.length} MCP tool(s) — call them directly from now on:`);
				for (const t of result.activated) {
					lines.push(`- ${t.name}: ${t.description}`);
				}
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
				details: { query: input.query, ...result },
			};
		},
	};
}
