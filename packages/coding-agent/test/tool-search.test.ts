import {
	createToolSearchTool,
	createToolSearchToolRegistration,
	scoreDeferredTools,
	type ToolSearchResult,
	type ToolSearchToolDetails,
} from "@vetta/runtime-tools/coding";
import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "../src/model-context/index.js";

const INDEX = [
	{ name: "mcp_notion_create_page", description: "Create a page in a Notion database or under a parent page" },
	{ name: "mcp_notion_query_database", description: "Query a Notion database with filters and sorts" },
	{ name: "mcp_github_create_issue", description: "Create an issue in a GitHub repository" },
	{ name: "mcp_filesystem_list_directory", description: "List directory contents" },
];

describe("scoreDeferredTools", () => {
	test("ranks name matches above description matches", () => {
		const ranked = scoreDeferredTools("notion page", INDEX);
		expect(ranked[0].name).toBe("mcp_notion_create_page");
		expect(ranked.map((r) => r.name)).toContain("mcp_notion_query_database");
		expect(ranked.map((r) => r.name)).not.toContain("mcp_filesystem_list_directory");
	});

	test("matches server name fragments", () => {
		const ranked = scoreDeferredTools("github", INDEX);
		expect(ranked).toHaveLength(1);
		expect(ranked[0].name).toBe("mcp_github_create_issue");
	});

	test("empty query returns nothing", () => {
		expect(scoreDeferredTools("   ", INDEX)).toHaveLength(0);
	});

	test("ties break deterministically by name", () => {
		const ranked = scoreDeferredTools("create", INDEX);
		expect(ranked.map((r) => r.name)).toEqual(["mcp_github_create_issue", "mcp_notion_create_page"]);
	});
});

describe("createToolSearchTool", () => {
	function makeTool(result: ToolSearchResult) {
		return createToolSearchTool({ search: () => result });
	}

	test("reports activated tools with descriptions", async () => {
		const tool = makeTool({
			activated: [{ name: "mcp_notion_create_page", description: "Create a page" }],
			alreadyActive: ["mcp_notion_query_database"],
			totalDeferred: 4,
		});
		const result = await executeToolSearch(tool, "notion");
		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("Activated 1 MCP tool(s)");
		expect(text).toContain("mcp_notion_create_page: Create a page");
		expect(text).toContain("Already active (call directly, do not search again): mcp_notion_query_database");
		expect((result.details as ToolSearchToolDetails).query).toBe("notion");
	});

	test("reports no-match with index size and retry hint", async () => {
		const tool = makeTool({ activated: [], alreadyActive: [], totalDeferred: 4 });
		const result = await executeToolSearch(tool, "nonexistent");
		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain('No MCP tools matched "nonexistent"');
		expect(text).toContain("4 deferred tool(s) indexed");
	});

	test("is registered but not default-active in any scenario", () => {
		const registration = createToolSearchToolRegistration({
			search: () => ({ activated: [], alreadyActive: [], totalDeferred: 0 }),
		});
		expect(registration.scopeUse).toEqual([]);
	});
});

function executeToolSearch(tool: ReturnType<typeof createToolSearchTool>, query: string) {
	return tool.execute({
		sessionId: "test-session",
		turnId: "test-turn",
		toolCallId: "test-call",
		input: { query },
		signal: new AbortController().signal,
	});
}

describe("system prompt MCP deferred section", () => {
	const mcpTools = [{ name: "mcp_notion_create_page", description: "Create a page in Notion" }];

	test("deferred mode renders index + tool_search activation guidance", () => {
		const prompt = buildSystemPrompt({
			selectedTools: ["read", "tool_search"],
			contextFiles: [],
			skills: [],
			mcpTools,
			mcpDeferred: true,
		});
		expect(prompt).toContain("MCP tool usage (deferred)");
		expect(prompt).toContain("tool_search");
		expect(prompt).toContain("mcp_notion_create_page");
	});

	test("non-deferred mode keeps direct usage guidance", () => {
		const prompt = buildSystemPrompt({
			selectedTools: ["read"],
			contextFiles: [],
			skills: [],
			mcpTools,
		});
		expect(prompt).not.toContain("MCP tool usage (deferred)");
		expect(prompt).toContain("**MCP tool usage**");
	});
});
