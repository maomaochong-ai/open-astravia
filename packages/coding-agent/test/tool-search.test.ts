import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "../src/model-context/index.js";

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
