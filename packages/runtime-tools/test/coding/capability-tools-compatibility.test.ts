import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { listAvailableTags, queryByTags, writeWikiPage } from "@vetta/runtime-knowledge";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	ASK_USER_QUESTION_TOOL_CATEGORY,
	ASK_USER_QUESTION_TOOL_DESCRIPTION,
	ASK_USER_QUESTION_TOOL_REQUIRES,
	ASK_USER_QUESTION_TOOL_SCOPES,
	AskUserQuestionToolInputSchema,
	type CodingToolRegistration,
	createAskUserQuestionToolRegistration,
	createInvokeSkillToolRegistration,
	createKbFilterByTagsToolRegistration,
	createKbListTagsToolRegistration,
	createMemoryToolRegistration,
	createTodoToolRegistration,
	createToolSearchToolRegistration,
	INVOKE_SKILL_TOOL_CATEGORY,
	INVOKE_SKILL_TOOL_DESCRIPTION,
	INVOKE_SKILL_TOOL_SCOPES,
	InvokeSkillToolInputSchema,
	KB_FILTER_BY_TAGS_TOOL_CATEGORY,
	KB_FILTER_BY_TAGS_TOOL_DESCRIPTION,
	KB_FILTER_BY_TAGS_TOOL_REQUIRES,
	KB_FILTER_BY_TAGS_TOOL_SCOPES,
	KB_LIST_TAGS_TOOL_CATEGORY,
	KB_LIST_TAGS_TOOL_DESCRIPTION,
	KB_LIST_TAGS_TOOL_REQUIRES,
	KB_LIST_TAGS_TOOL_SCOPES,
	KbFilterByTagsToolInputSchema,
	KbListTagsToolInputSchema,
	MEMORY_TOOL_CATEGORY,
	MEMORY_TOOL_DESCRIPTION,
	MEMORY_TOOL_SCOPES,
	MemoryToolInputSchema,
	type MemoryToolOperations,
	scoreDeferredTools,
	TODO_TOOL_CATEGORY,
	TODO_TOOL_DESCRIPTION,
	TODO_TOOL_SCOPES,
	TOOL_SEARCH_TOOL_CATEGORY,
	TOOL_SEARCH_TOOL_DESCRIPTION,
	TOOL_SEARCH_TOOL_SCOPES,
	TodoToolInputSchema,
	type TodoToolItem,
	type TodoToolStatus,
	type TodoToolStore,
	ToolSearchToolInputSchema,
} from "../../src/coding/index.js";

interface ExpectedRegistration {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly schema: Readonly<Record<string, unknown>>;
	readonly scopeUse: readonly string[];
	readonly requires?: readonly string[];
	readonly category: string;
}

const signal = new AbortController().signal;
let testRoot = "";

beforeAll(async () => {
	testRoot = await mkdtemp(join(tmpdir(), "runtime-capability-tools-"));
	const timestamp = "2026-08-04T00:00:00.000Z";
	await writeWikiPage(
		testRoot,
		"topic/page.md",
		{
			id: "page-1",
			source: "test",
			source_path: "test/page.md",
			source_hash: "hash-1",
			tags: ["runtime", "tool"],
			title: "Runtime Tool",
			summary: "Native tool contract",
			created_at: timestamp,
			updated_at: timestamp,
			orphaned_at: null,
		},
		"body",
	);
});

afterAll(async () => {
	if (testRoot) await rm(testRoot, { recursive: true, force: true });
});

describe("native capability tool compatibility", () => {
	it("keeps all model-visible definitions and registration metadata", () => {
		const ask = async () => ({ cancelled: true, answers: [] });
		const skill = createSkill();
		const search = () => ({ activated: [], alreadyActive: [], totalDeferred: 0 });
		const todoStore = new TestTodoStore();
		const memoryOperations = createInMemoryMemoryOperations();
		const knowledgeOperations = createKnowledgeOperations();

		expectRegistration(createAskUserQuestionToolRegistration({ ask }), {
			name: "ask_user_question",
			label: "Ask User",
			description: ASK_USER_QUESTION_TOOL_DESCRIPTION,
			schema: AskUserQuestionToolInputSchema,
			scopeUse: ASK_USER_QUESTION_TOOL_SCOPES,
			requires: ASK_USER_QUESTION_TOOL_REQUIRES,
			category: ASK_USER_QUESTION_TOOL_CATEGORY,
		});
		expectRegistration(
			createInvokeSkillToolRegistration({
				getSkills: () => [skill],
				readBody: () => "Follow the PDF workflow.",
			}),
			{
				name: "invoke_skill",
				label: "invoke_skill",
				description: INVOKE_SKILL_TOOL_DESCRIPTION,
				schema: InvokeSkillToolInputSchema,
				scopeUse: INVOKE_SKILL_TOOL_SCOPES,
				category: INVOKE_SKILL_TOOL_CATEGORY,
			},
		);
		expectRegistration(createToolSearchToolRegistration({ search }), {
			name: "tool_search",
			label: "Tool Search",
			description: TOOL_SEARCH_TOOL_DESCRIPTION,
			schema: ToolSearchToolInputSchema,
			scopeUse: TOOL_SEARCH_TOOL_SCOPES,
			category: TOOL_SEARCH_TOOL_CATEGORY,
		});
		const memory = createMemoryToolRegistration({ operations: memoryOperations });
		expect({
			name: memory.tool.name,
			label: memory.tool.label,
			description: memory.tool.description,
			schema: memory.tool.inputSchema,
			scopeUse: memory.scopeUse,
			category: memory.category,
		}).toEqual({
			name: "memory",
			label: "Memory",
			description: MEMORY_TOOL_DESCRIPTION,
			schema: MemoryToolInputSchema,
			scopeUse: MEMORY_TOOL_SCOPES,
			category: MEMORY_TOOL_CATEGORY,
		});
		expectRegistration(createTodoToolRegistration({ getTodoStore: () => todoStore }), {
			name: "todo",
			label: "todo",
			description: TODO_TOOL_DESCRIPTION,
			schema: TodoToolInputSchema,
			scopeUse: TODO_TOOL_SCOPES,
			category: TODO_TOOL_CATEGORY,
		});
		expectRegistration(createKbListTagsToolRegistration({ operations: knowledgeOperations }), {
			name: "kb_list_available_tags",
			label: "KB List Tags",
			description: KB_LIST_TAGS_TOOL_DESCRIPTION,
			schema: KbListTagsToolInputSchema,
			scopeUse: KB_LIST_TAGS_TOOL_SCOPES,
			requires: KB_LIST_TAGS_TOOL_REQUIRES,
			category: KB_LIST_TAGS_TOOL_CATEGORY,
		});
		expectRegistration(createKbFilterByTagsToolRegistration({ operations: knowledgeOperations }), {
			name: "kb_filter_by_tags",
			label: "KB Filter by Tags",
			description: KB_FILTER_BY_TAGS_TOOL_DESCRIPTION,
			schema: KbFilterByTagsToolInputSchema,
			scopeUse: KB_FILTER_BY_TAGS_TOOL_SCOPES,
			requires: KB_FILTER_BY_TAGS_TOOL_REQUIRES,
			category: KB_FILTER_BY_TAGS_TOOL_CATEGORY,
		});
	});

	it("keeps ask_user_question answer and cancellation results", async () => {
		const ask = async () => ({
			cancelled: false,
			answers: [{ question: "Choose?", answers: ["First"] }],
		});
		const input = {
			description: "Clarify",
			questions: [
				{
					question: "Choose?",
					header: "Choice",
					options: [
						{ label: "First", description: "One" },
						{ label: "Second", description: "Two" },
					],
				},
			],
		};
		const runtime = createAskUserQuestionToolRegistration({ ask }).tool;
		expect(await executeRuntime(runtime, input)).toEqual({
			content: [
				{
					type: "text",
					text: 'User has answered your questions: "Choose?"="First". You can now continue with the user\'s answers in mind.',
				},
			],
			details: { cancelled: false, answers: [{ question: "Choose?", answers: ["First"] }] },
		});
	});

	it("keeps invoke_skill success, missing, and read-error results", async () => {
		const skill = createSkill();
		const runtime = createInvokeSkillToolRegistration({
			getSkills: () => [skill],
			readBody: () => "Follow the PDF workflow.",
		}).tool;
		const success = await executeRuntime(runtime, { name: "pdf", args: "source.pdf" });
		expect(success.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining('<skill name="pdf" location="C:/skills/pdf/SKILL.md">'),
		});
		expect(success.content[0]).toMatchObject({ text: expect.stringContaining("User arguments: source.pdf") });
		expect(success.details).toEqual({ skillName: "pdf", skillLocation: "C:/skills/pdf/SKILL.md" });
		expect(await executeRuntime(runtime, { name: "missing" })).toEqual({
			content: [{ type: "text", text: 'Error: Skill "missing" not found. Available skills: pdf' }],
			details: { skillName: "missing", skillLocation: "" },
		});
	});

	it("keeps deferred tool scoring, activation output, and max-result clamping", async () => {
		const entries = [
			{ name: "github_issue", description: "Manage repository issues" },
			{ name: "notion_page", description: "Manage pages" },
		];
		expect(scoreDeferredTools("github issue", entries)).toEqual([
			{ name: "github_issue", description: "Manage repository issues" },
		]);
		const calls: number[] = [];
		const search = (_query: string, maxResults: number) => {
			calls.push(maxResults);
			return { activated: [entries[0]], alreadyActive: [entries[1].name], totalDeferred: entries.length };
		};
		const runtime = createToolSearchToolRegistration({ search }).tool;
		const input = { query: "issue", max_results: 99 };
		expect(await executeRuntime(runtime, input)).toEqual({
			content: [
				{
					type: "text",
					text: "Activated 1 MCP tool(s) — callable from now on:\n- github_issue: Manage repository issues\nAlready active (call directly, do not search again): notion_page",
				},
			],
			details: {
				query: "issue",
				activated: [entries[0]],
				alreadyActive: ["notion_page"],
				totalDeferred: 2,
			},
		});
		expect(calls).toEqual([10]);
	});

	it("keeps memory add and replace state transitions", async () => {
		const runtime = createMemoryToolRegistration({
			operations: createInMemoryMemoryOperations(),
		}).tool;
		expect(await executeRuntime(runtime, { action: "add", content: "Uses Bun" })).toEqual({
			content: [{ type: "text", text: "memory add ok — 1 entry, 8/4000 chars.\n\nCurrent memory:\n1. Uses Bun" }],
			details: { action: "add", entryCount: 1, chars: 8, limit: 4_000 },
		});
		expect(
			await executeRuntime(runtime, { action: "replace", match: "Bun", content: "Uses Bun workspaces" }),
		).toEqual({
			content: [
				{
					type: "text",
					text: "memory replace ok — 1 entry, 19/4000 chars.\n\nCurrent memory:\n1. Uses Bun workspaces",
				},
			],
			details: { action: "replace", entryCount: 1, chars: 19, limit: 4_000 },
		});
	});

	it("keeps todo creation, update, listing, and clear behavior", async () => {
		const runtimeStore = new TestTodoStore();
		const runtime = createTodoToolRegistration({ getTodoStore: () => runtimeStore }).tool;
		const inputs = [
			{ action: "create" as const, items: ["First", "Second"] },
			{ action: "update" as const, id: 1, status: "in_progress" as const },
			{ action: "list" as const },
			{ action: "clear" as const },
		];
		const results = [];
		for (const input of inputs) results.push(await executeRuntime(runtime, input));
		expect(results.map((result) => result.details)).toEqual([
			{ action: "create" },
			{ action: "update" },
			{ action: "list" },
			{ action: "clear" },
		]);
		expect(results[0]?.content[0]).toMatchObject({ text: expect.stringContaining("Created 2 todo items") });
		expect(results[1]?.content[0]).toMatchObject({ text: expect.stringContaining("Updated #1 → in_progress") });
		expect(results[2]?.content[0]).toMatchObject({ text: expect.stringContaining("[~] #1 First") });
		expect(results[3]?.content[0]).toMatchObject({ text: expect.stringContaining("Cleared all todo items") });
		expect(runtimeStore.getAll()).toEqual([]);
	});

	it("keeps knowledge tag listing and filtering results", async () => {
		const operations = createKnowledgeOperations();
		const runtimeList = createKbListTagsToolRegistration({ operations }).tool;
		expect(await executeRuntime(runtimeList, {})).toEqual({
			content: [{ type: "text", text: "kb_list_available_tags — 2 tag(s):\n- runtime (1)\n- tool (1)" }],
			details: {
				tags: [
					{ tag: "runtime", count: 1 },
					{ tag: "tool", count: 1 },
				],
			},
		});

		const runtimeFilter = createKbFilterByTagsToolRegistration({ operations }).tool;
		const input = { all: ["runtime"] };
		const result = await executeRuntime(runtimeFilter, input);
		expect(result.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("kb_filter_by_tags matched 1 page(s)"),
		});
		expect(result.details).toMatchObject({
			count: 1,
			pages: [{ id: "page-1", title: "Runtime Tool", tags: ["runtime", "tool"] }],
		});
	});
});

function expectRegistration<TInput extends object>(
	registration: CodingToolRegistration<TInput>,
	expected: ExpectedRegistration,
): void {
	expect({
		name: registration.tool.name,
		label: registration.tool.label,
		description: registration.tool.description,
		schema: registration.tool.inputSchema,
		scopeUse: registration.scopeUse,
		requires: registration.requires,
		category: registration.category,
	}).toEqual(expected);
}

async function executeRuntime<TInput extends object>(tool: RuntimeToolDefinition<TInput>, input: TInput) {
	return tool.execute({
		sessionId: "session",
		turnId: "turn",
		toolCallId: "runtime",
		input,
		signal,
	});
}

function createSkill() {
	return {
		name: "pdf",
		description: "PDF workflow",
		filePath: "C:/skills/pdf/SKILL.md",
		baseDir: "C:/skills/pdf",
		source: "test",
		type: "skill" as const,
		disableModelInvocation: false,
		content: "---\nname: pdf\n---\nFollow the PDF workflow.",
	};
}

class TestTodoStore implements TodoToolStore {
	private items: TodoToolItem[] = [];
	private nextId = 1;

	getAll(): readonly TodoToolItem[] {
		return this.items;
	}

	isLocked(): boolean {
		return false;
	}

	getLockSource(): string | null {
		return null;
	}

	createMany(contents: string[]): readonly TodoToolItem[] {
		const created = contents.map((content) => ({ id: this.nextId++, content, status: "pending" as const }));
		this.items.push(...created);
		return created;
	}

	update(id: number, status: TodoToolStatus): TodoToolItem | undefined {
		const index = this.items.findIndex((item) => item.id === id);
		if (index < 0) return undefined;
		const updated = { ...this.items[index], status };
		this.items[index] = updated;
		return updated;
	}

	clear(): void {
		this.items = [];
	}
}

function createKnowledgeOperations() {
	return {
		listAvailableTags: () => listAvailableTags(testRoot),
		queryByTags: async (input: { all?: string[]; any?: string[]; none?: string[] }) => {
			const pages = await queryByTags(testRoot, input);
			return pages.map((page) => ({ ...page, absolutePath: join(testRoot, "wiki", page.path) }));
		},
	};
}

function createInMemoryMemoryOperations(): MemoryToolOperations {
	const entries: string[] = [];
	return {
		apply(action, input) {
			if (action === "add") entries.push(input.content ?? "");
			if (action === "replace") {
				const index = entries.findIndex((entry) => entry.includes(input.match ?? ""));
				if (index >= 0) entries[index] = input.content ?? "";
			}
			if (action === "remove") {
				const index = entries.findIndex((entry) => entry.includes(input.match ?? ""));
				if (index >= 0) entries.splice(index, 1);
			}
			return { entries: [...entries], chars: entries.join("\n\n§\n\n").length, limit: 4_000 };
		},
	};
}
