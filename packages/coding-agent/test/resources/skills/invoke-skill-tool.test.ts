import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import type { Skill } from "../../../src/resources/skills/contracts.js";
import {
	createInvokeSkillToolRegistration,
	INVOKE_SKILL_TOOL_CATEGORY,
	INVOKE_SKILL_TOOL_DESCRIPTION,
	INVOKE_SKILL_TOOL_SCOPES,
	InvokeSkillToolInputSchema,
} from "../../../src/resources/skills/index.js";

const signal = new AbortController().signal;

describe("Coding Agent invoke_skill Tool", () => {
	it("keeps the stable model-visible definition and registration metadata", () => {
		const registration = createInvokeSkillToolRegistration({
			getSkills: () => [createSkill()],
			readBody: () => "Follow the PDF workflow.",
		});

		expect({
			name: registration.tool.name,
			label: registration.tool.label,
			description: registration.tool.description,
			schema: registration.tool.inputSchema,
			scopeUse: registration.scopeUse,
			category: registration.category,
		}).toEqual({
			name: "invoke_skill",
			label: "invoke_skill",
			description: INVOKE_SKILL_TOOL_DESCRIPTION,
			schema: InvokeSkillToolInputSchema,
			scopeUse: INVOKE_SKILL_TOOL_SCOPES,
			category: INVOKE_SKILL_TOOL_CATEGORY,
		});
	});

	it("keeps success, missing, and read-error results", async () => {
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

		const failed = createInvokeSkillToolRegistration({
			getSkills: () => [skill],
			readBody: () => {
				throw new Error("unreadable");
			},
		}).tool;
		expect(await executeRuntime(failed, { name: "pdf" })).toEqual({
			content: [
				{
					type: "text",
					text: 'Error reading skill "pdf" from C:/skills/pdf/SKILL.md: unreadable',
				},
			],
			details: { skillName: "pdf", skillLocation: "C:/skills/pdf/SKILL.md" },
		});
	});
});

async function executeRuntime<TInput extends object>(tool: RuntimeToolDefinition<TInput>, input: TInput) {
	return tool.execute({
		sessionId: "session",
		turnId: "turn",
		toolCallId: "runtime",
		input,
		signal,
	});
}

function createSkill(): Skill {
	return {
		name: "pdf",
		description: "PDF workflow",
		filePath: "C:/skills/pdf/SKILL.md",
		baseDir: "C:/skills/pdf",
		source: "test",
		type: "skill",
		disableModelInvocation: false,
		content: "---\nname: pdf\n---\nFollow the PDF workflow.",
		sceneTasks: [],
	};
}
