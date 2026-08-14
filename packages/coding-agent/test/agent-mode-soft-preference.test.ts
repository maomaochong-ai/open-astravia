import { describe, expect, it } from "vitest";
import { resolveSystemPromptOptionsFromSources } from "../src/model-context/system-prompt-sources.js";
import type { Skill } from "../src/resources/skills/index.js";
import { createCodingAgentInvokeSkillFeature } from "../src/resources/skills/invoke-skill-feature.js";
import type { CodingAgentPromptResourceSource } from "../src/runtime-contracts/prompt-runtime.js";

/**
 * ADR-0071 合同：工作模式是任务解释的先验，不影响能力面。
 * Skill 清单在任何模式下集合与顺序都完全一致（加载序），mode 只改变 modePrompt block；
 * invoke_skill 的可调用集合同样与模式无关。回归出「因模式改变清单」即违约。
 */
describe("工作模式不影响 Skill 清单（ADR-0071）", () => {
	const skills = [skill("beta"), skill("alpha"), skill("gamma")];

	it("system prompt 的 Skill 清单在各模式下集合与顺序一致，且保持加载序", () => {
		const work = promptSkillNames(skills, "work");
		const coding = promptSkillNames(skills, "coding");
		const none = promptSkillNames(skills, undefined);

		expect(work).toEqual(["beta", "alpha", "gamma"]);
		expect(coding).toEqual(work);
		expect(none).toEqual(work);
	});

	it("mode 只改变 modePrompt block，不触碰 skills", () => {
		const work = resolveSystemPromptOptionsFromSources(dependencies(skills, "work"));
		const coding = resolveSystemPromptOptionsFromSources(dependencies(skills, "coding"));

		expect(work.modePrompt).not.toEqual(coding.modePrompt);
		expect(work.skills).toEqual(coding.skills);
	});

	it("invoke_skill 的可调用集合与模式无关", async () => {
		const feature = createCodingAgentInvokeSkillFeature({
			resourceSource: resourceSource([skill("any-skill")]),
		});

		const result = await feature.tool.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call-1",
			input: { description: "Load any-skill", name: "any-skill" },
			signal: new AbortController().signal,
		});

		expect(JSON.stringify(result.content)).toContain("body of any-skill");
	});
});

function promptSkillNames(skills: readonly Skill[], agentMode: string | undefined): string[] {
	const options = resolveSystemPromptOptionsFromSources(dependencies(skills, agentMode));
	return (options.skills ?? []).map(({ name }) => name);
}

function skill(name: string): Skill {
	return {
		name,
		description: `${name} skill`,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
		source: "user",
		type: "skill",
		disableModelInvocation: false,
		content: `---\nname: ${name}\ndescription: ${name} skill\n---\nbody of ${name}\n`,
	};
}

function resourceSource(skills: readonly Skill[]): CodingAgentPromptResourceSource {
	return {
		refreshContextResourcesIfChanged: () => false,
		refreshSkillsIfChanged: () => false,
		getSkills: () => ({ skills: [...skills], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => [],
		setRuntimeSkillPaths: () => {},
	};
}

function dependencies(skills: readonly Skill[], agentMode: string | undefined) {
	return {
		toolNames: [],
		resourceLoader: resourceSource(skills),
		mcpManager: undefined,
		cwd: "/workspace",
		settingsManager: { getPersonalization: () => ({ personaId: "", customPrompt: "" }) },
		memoryMode: false,
		memoryFile: undefined,
		memorySnapshot: "",
		memoryCharLimit: 0,
		agentMode,
	};
}
