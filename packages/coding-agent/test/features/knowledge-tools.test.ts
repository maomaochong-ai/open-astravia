import { describe, expect, it, vi } from "vitest";
import {
	CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_CATEGORY,
	CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_DESCRIPTION,
	CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_REQUIRES,
	CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_SCOPES,
	CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_CATEGORY,
	CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_DESCRIPTION,
	CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_REQUIRES,
	CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_SCOPES,
	CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_CATEGORY,
	CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_DESCRIPTION,
	CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_REQUIRES,
	CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_SCOPES,
	createCodingAgentKnowledgeFilterByTagsToolRegistration,
	createCodingAgentKnowledgeListTagsToolRegistration,
	createCodingAgentKnowledgeWritePageTool,
} from "../../src/features/knowledge/index.js";

describe("Coding Agent Knowledge tools", () => {
	it("keeps the query tool contracts and result projections", async () => {
		const operations = {
			listAvailableTags: vi.fn(async () => [
				{ tag: "runtime", count: 1 },
				{ tag: "tool", count: 1 },
			]),
			queryByTags: vi.fn(async () => [
				{
					id: "page-1",
					path: "runtime/tool.md",
					absolutePath: "/knowledge/wiki/runtime/tool.md",
					title: "Runtime Tool",
					summary: "A runtime tool",
					tags: ["runtime", "tool"],
				},
			]),
		};
		const list = createCodingAgentKnowledgeListTagsToolRegistration({ operations }).tool;
		const filter = createCodingAgentKnowledgeFilterByTagsToolRegistration({ operations }).tool;

		expect(list.description).toBe(CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_DESCRIPTION);
		expect(filter.description).toBe(CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_DESCRIPTION);
		expect({
			name: list.name,
			scopeUse: createCodingAgentKnowledgeListTagsToolRegistration({ operations }).scopeUse,
			requires: createCodingAgentKnowledgeListTagsToolRegistration({ operations }).requires,
			category: createCodingAgentKnowledgeListTagsToolRegistration({ operations }).category,
		}).toEqual({
			name: "kb_list_available_tags",
			scopeUse: CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_SCOPES,
			requires: CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_REQUIRES,
			category: CODING_AGENT_KNOWLEDGE_LIST_TAGS_TOOL_CATEGORY,
		});
		expect(createCodingAgentKnowledgeFilterByTagsToolRegistration({ operations })).toMatchObject({
			scopeUse: CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_SCOPES,
			requires: CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_REQUIRES,
			category: CODING_AGENT_KNOWLEDGE_FILTER_BY_TAGS_TOOL_CATEGORY,
		});

		expect(await list.execute(executionContext({}))).toEqual({
			content: [{ type: "text", text: "kb_list_available_tags — 2 tag(s):\n- runtime (1)\n- tool (1)" }],
			details: {
				tags: [
					{ tag: "runtime", count: 1 },
					{ tag: "tool", count: 1 },
				],
			},
		});
		expect(await filter.execute(executionContext({ all: ["runtime"] }))).toMatchObject({
			content: [expect.objectContaining({ text: expect.stringContaining("kb_filter_by_tags matched 1 page(s)") })],
			details: { count: 1, pages: [{ id: "page-1", absolutePath: "/knowledge/wiki/runtime/tool.md" }] },
		});
		expect(operations.queryByTags).toHaveBeenCalledWith({ all: ["runtime"] });
	});

	it("keeps write routing, timestamping, path resolution, and details", async () => {
		const write = vi.fn(async () => ({
			action: "update" as const,
			id: "page-1",
			path: "产品/计费.md",
			movedFrom: "旧目录/计费.md",
		}));
		const tool = createCodingAgentKnowledgeWritePageTool({
			operations: {
				write,
				resolveAbsolutePath: (path) => `/knowledge/wiki/${path}`,
			},
			now: () => new Date("2026-08-04T10:00:00.000Z"),
		});
		const input = {
			description: "Update page",
			path: "产品/计费.md",
			source: "manual",
			source_path: "计费.md",
			source_hash: "hash-1",
			tags: ["产品"],
			title: "计费",
			summary: "计费规则",
			body: "正文",
			id: "page-1",
		};

		expect(tool.description).toBe(CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_DESCRIPTION);
		expect(await tool.execute(executionContext(input))).toEqual({
			content: [
				{
					type: "text",
					text: "kb_write_page update ok — id=page-1, path=/knowledge/wiki/产品/计费.md (moved from 旧目录/计费.md)",
				},
			],
			details: {
				action: "update",
				id: "page-1",
				path: "产品/计费.md",
				absolutePath: "/knowledge/wiki/产品/计费.md",
				movedFrom: "旧目录/计费.md",
			},
		});
		expect(write).toHaveBeenCalledWith(input, "2026-08-04T10:00:00.000Z");
		expect({
			scopeUse: CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_SCOPES,
			requires: CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_REQUIRES,
			category: CODING_AGENT_KNOWLEDGE_WRITE_PAGE_TOOL_CATEGORY,
		}).toEqual({
			scopeUse: ["kb-processing"],
			requires: ["knowledge"],
			category: "kb-write",
		});
	});
});

function executionContext<TInput extends object>(input: TInput) {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId: "call-1",
		input,
		signal: new AbortController().signal,
	};
}
