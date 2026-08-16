import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import {
	ASK_USER_QUESTION_TOOL_CATEGORY,
	ASK_USER_QUESTION_TOOL_DESCRIPTION,
	ASK_USER_QUESTION_TOOL_REQUIRES,
	ASK_USER_QUESTION_TOOL_SCOPES,
	AskUserQuestionToolInputSchema,
	type CodingToolRegistration,
	createAskUserQuestionToolRegistration,
	createInvokeSkillToolRegistration,
	createToolSearchToolRegistration,
	INVOKE_SKILL_TOOL_CATEGORY,
	INVOKE_SKILL_TOOL_DESCRIPTION,
	INVOKE_SKILL_TOOL_SCOPES,
	InvokeSkillToolInputSchema,
	scoreDeferredTools,
	TOOL_SEARCH_TOOL_CATEGORY,
	TOOL_SEARCH_TOOL_DESCRIPTION,
	TOOL_SEARCH_TOOL_SCOPES,
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

describe("native capability tool compatibility", () => {
	it("keeps all model-visible definitions and registration metadata", () => {
		const ask = async () => ({ cancelled: true, answers: [] });
		const skill = createSkill();
		const search = () => ({ activated: [], alreadyActive: [], totalDeferred: 0 });

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
