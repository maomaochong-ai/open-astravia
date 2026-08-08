import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import type { Skill } from "../../src/resources/skills/index.js";
import { createCodingAgentInvokeSkillFeature } from "../../src/resources/skills/invoke-skill-feature.js";
import type { CodingAgentPromptResourceSource } from "../../src/runtime-contracts/prompt-runtime.js";

describe("Skill Hook invocation", () => {
	it("activates frontmatter hooks only after invoke_skill completes successfully", async () => {
		const registerCurrentTurnContribution = vi.fn(async () => true);
		const feature = createFeature(skillDocumentWithHooks(), registerCurrentTurnContribution);
		const wrapped = feature.wrapHookActivation(new Map([[feature.tool.name, feature.tool]])).get("invoke_skill");
		if (!wrapped) throw new Error("Expected wrapped invoke_skill tool");

		const result = await wrapped.execute(request("call-1"));

		expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Review carefully") });
		expect(registerCurrentTurnContribution).toHaveBeenCalledTimes(1);
		expect(registerCurrentTurnContribution).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "skill:C:/skills/review/SKILL.md",
				profileId: "claude-code-hooks/2.1.211",
				sourcePath: "C:/skills/review/SKILL.md",
				configuration: expect.objectContaining({ PreToolUse: expect.any(Array) }),
				env: expect.objectContaining({ CLAUDE_SKILL_DIR: "C:/skills/review" }),
			}),
		);
	});

	it("discards a pending activation when the wrapped invoke result is rejected", async () => {
		const registerCurrentTurnContribution = vi.fn(async () => true);
		const feature = createFeature(skillDocumentWithHooks(), registerCurrentTurnContribution);
		const rejectedTool: RuntimeToolDefinition = {
			...feature.tool,
			async execute(input) {
				await feature.tool.execute(input);
				throw new Error("existing PostToolUse hook rejected invoke_skill");
			},
		};
		const wrapped = feature.wrapHookActivation(new Map([[rejectedTool.name, rejectedTool]])).get("invoke_skill");
		if (!wrapped) throw new Error("Expected wrapped invoke_skill tool");

		await expect(wrapped.execute(request("call-2"))).rejects.toThrow("PostToolUse hook rejected");
		expect(registerCurrentTurnContribution).not.toHaveBeenCalled();
	});

	it("does not register a contribution for a Skill without hooks", async () => {
		const registerCurrentTurnContribution = vi.fn(async () => true);
		const feature = createFeature(
			"---\nname: review\ndescription: Review workflow\n---\nReview carefully.\n",
			registerCurrentTurnContribution,
		);
		const wrapped = feature.wrapHookActivation(new Map([[feature.tool.name, feature.tool]])).get("invoke_skill");
		if (!wrapped) throw new Error("Expected wrapped invoke_skill tool");

		await wrapped.execute(request("call-3"));
		expect(registerCurrentTurnContribution).not.toHaveBeenCalled();
	});
});

function createFeature(
	content: string,
	registerCurrentTurnContribution: Pick<
		EcosystemHookRuntime,
		"registerCurrentTurnContribution"
	>["registerCurrentTurnContribution"],
) {
	const skill: Skill = {
		name: "review",
		description: "Review workflow",
		filePath: "C:/skills/review/SKILL.md",
		baseDir: "C:/skills/review",
		source: "user",
		type: "skill",
		disableModelInvocation: false,
		content,
	};
	const resourceSource: CodingAgentPromptResourceSource = {
		refreshSkillsIfChanged: () => false,
		getSkills: () => ({ skills: [skill], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => [],
		setRuntimeSkillPaths: () => {},
	};
	return createCodingAgentInvokeSkillFeature({
		resourceSource,
		hookRuntime: { registerCurrentTurnContribution },
	});
}

function request(toolCallId: string) {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId,
		input: { description: "Load review workflow", name: "review" },
		signal: new AbortController().signal,
	};
}

function skillDocumentWithHooks(): string {
	return `---
name: review
description: Review workflow
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: node check.cjs
---
Review carefully.
`;
}
