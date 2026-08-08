import { describe, expect, it, vi } from "vitest";
import {
	createMcpDeferredToolController,
	createMcpToolSearchRuntimeTool,
	MCP_TOOL_SEARCH_DESCRIPTION,
	renderMcpToolsInstruction,
	scoreMcpDeferredTools,
} from "../src/index.js";

describe("MCP deferred tool contract", () => {
	it("scores name matches above description matches and sorts ties by name", () => {
		const tools = [
			{ name: "mcp_docs_lookup", description: "Search pages" },
			{ name: "mcp_pages_read", description: "Read docs" },
			{ name: "mcp_alpha_docs", description: "Unrelated" },
		];

		expect(scoreMcpDeferredTools("docs pages", tools).map(({ name }) => name)).toEqual([
			"mcp_docs_lookup",
			"mcp_pages_read",
			"mcp_alpha_docs",
		]);
		expect(scoreMcpDeferredTools("  ", tools)).toEqual([]);
	});

	it("renders the existing plain MCP index and truncates descriptions to one line", () => {
		const instruction = renderMcpToolsInstruction(
			[
				{
					name: "mcp_docs_lookup",
					description: `${"x".repeat(205)}\nsecond line`,
				},
			],
			true,
		);

		expect(instruction).toContain("MCP (Model Context Protocol) tools:");
		expect(instruction).toContain(`- mcp_docs_lookup: ${"x".repeat(200)}…`);
		expect(instruction).not.toContain("second line");
		expect(instruction).toContain("**MCP tool usage (deferred)**");
		expect(renderMcpToolsInstruction([], true)).toBe("");
	});

	it("summarizes large deferred indexes by server while keeping the full search index out of the prompt", () => {
		const tools = Array.from({ length: 16 }, (_, index) => ({
			name: `mcp_docs_tool_${index}`,
			description: `Description ${index}`,
		}));

		const instruction = renderMcpToolsInstruction(tools, true);

		expect(instruction).toContain("- docs (16 tools): tool_0, tool_1, tool_2, ...");
		expect(instruction).not.toContain("Description 15");
		expect(instruction).not.toContain("mcp_docs_tool_15");
		expect(instruction).toContain("tool_search");
	});

	it("keeps the tool_search schema, clamping and model-visible result", async () => {
		const search = vi.fn(() => ({
			activated: [{ name: "mcp_docs_lookup", description: "Search pages" }],
			alreadyActive: ["mcp_docs_read"],
			totalDeferred: 16,
		}));
		const tool = createMcpToolSearchRuntimeTool(search);

		expect(tool).toMatchObject({
			name: "tool_search",
			label: "Tool Search",
			description: MCP_TOOL_SEARCH_DESCRIPTION,
			inputSchema: {
				type: "object",
				required: ["query"],
			},
		});
		const result = await tool.execute({
			sessionId: "session",
			turnId: "turn",
			toolCallId: "call",
			input: { query: "docs", max_results: 99 },
			signal: new AbortController().signal,
		});

		expect(search).toHaveBeenCalledWith("docs", 10);
		expect(result).toEqual({
			content: [
				{
					type: "text",
					text:
						"Activated 1 MCP tool(s) — callable from now on:\n" +
						"- mcp_docs_lookup: Search pages\n" +
						"Already active: mcp_docs_read",
				},
			],
			details: {
				query: "docs",
				activated: [{ name: "mcp_docs_lookup", description: "Search pages" }],
				alreadyActive: ["mcp_docs_read"],
				totalDeferred: 16,
			},
		});
	});

	it("activates real tool schemas dynamically and hides removed tools until they return", async () => {
		const controller = createMcpDeferredToolController({ sessionId: "session", threshold: 1 });
		const tools = [
			{ name: "mcp_docs_lookup", description: "Search pages" },
			{ name: "mcp_issues_create", description: "Create issue" },
		];
		controller.refresh({ revision: 1, tools });
		expect(controller.isToolVisible("mcp_docs_lookup")).toBe(false);

		const feature = await controller.createFeature().prepare({ signal: new AbortController().signal });
		const contribution = await feature.contribute({
			profileId: "coding-agent",
			signal: new AbortController().signal,
		});
		const callContribution = await contribution.modelCallProviders?.[0]?.contribute({
			sessionId: "session",
			turnId: "turn",
			signal: new AbortController().signal,
		});
		const search = callContribution?.tools?.find(({ name }) => name === "tool_search");
		if (!search) throw new Error("Expected deferred MCP tool_search");
		await search.execute({
			sessionId: "session",
			turnId: "turn",
			toolCallId: "call",
			input: { query: "docs" },
			signal: new AbortController().signal,
		});
		expect(controller.isToolVisible("mcp_docs_lookup")).toBe(true);

		controller.refresh({ revision: 2, tools: [tools[1]!] });
		expect(controller.isToolVisible("mcp_docs_lookup")).toBe(false);
		controller.refresh({ revision: 3, tools });
		expect(controller.isToolVisible("mcp_docs_lookup")).toBe(true);
	});
});
