import type { AgentMessage } from "@vetta/agent-core";
import { describe, expect, it } from "vitest";
import {
	applySystemPromptOperations,
	BRANCH_SUMMARY_PREFIX,
	buildSystemPrompt,
	convertToLlm,
	formatSkillsForProductPrompt,
	PROMPT_RESOURCE_REFERENCE_TYPE,
	type SystemPromptDraft,
} from "../src/model-context/index.js";

describe("Coding Agent model context", () => {
	it("projects model-visible messages and excludes persisted resource markers", () => {
		const messages = [
			{
				role: "custom",
				customType: PROMPT_RESOURCE_REFERENCE_TYPE,
				content: "hidden resource metadata",
				display: false,
				timestamp: 1,
			},
			{
				role: "bashExecution",
				command: "echo ok",
				output: "ok",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: 2,
			},
			{ role: "branchSummary", summary: "earlier work", fromId: "entry-1", timestamp: 3 },
		] satisfies AgentMessage[];

		const projected = convertToLlm(messages);
		expect(projected).toHaveLength(2);
		expect(projected[0]).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "Ran `echo ok`\n```\nok\n```" }],
		});
		expect(projected[1]).toMatchObject({
			role: "user",
			content: [{ type: "text", text: `${BRANCH_SUMMARY_PREFIX}earlier work</summary>` }],
		});
	});

	it("applies plugin operations without mutating the base prompt document", () => {
		const draft: SystemPromptDraft = {
			blocks: [
				{
					id: "core.base",
					type: "base",
					source: { kind: "core" },
					content: "base",
					priority: 100,
					enabled: true,
				},
			],
			metadata: { cwd: "C:/workspace", dateTime: "fixed" },
		};

		const next = applySystemPromptOperations(draft, "plugin-a", [
			{
				type: "addBlock",
				block: {
					id: "plugin.extra",
					type: "plugin",
					source: { kind: "core" },
					content: "extra",
					priority: 200,
					enabled: true,
				},
			},
		]);

		expect(draft.blocks).toHaveLength(1);
		expect(next.blocks[1]?.source).toEqual({ kind: "plugin", pluginId: "plugin-a" });
	});

	it("rebuilds product prompt and skill index from current inputs", () => {
		const readPrompt = buildSystemPrompt({ selectedTools: ["read"], skills: [] });
		const writePrompt = buildSystemPrompt({ selectedTools: ["write"], skills: [] });
		expect(readPrompt).toContain("- read:");
		expect(readPrompt).not.toContain("- write:");
		expect(writePrompt).toContain("- write:");

		expect(
			formatSkillsForProductPrompt([
				{ name: "a&b", description: "<read>", type: "skill", disableModelInvocation: false },
				{ name: "hidden", description: "hidden", type: "scene", disableModelInvocation: false },
			]),
		).toContain("<name>a&amp;b</name>\n    <description>&lt;read&gt;</description>");
	});
});
