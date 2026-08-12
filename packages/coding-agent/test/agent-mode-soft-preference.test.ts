import { describe, expect, it } from "vitest";
import { resolveSystemPromptOptionsFromSources } from "../src/model-context/system-prompt-sources.js";
import type { Skill } from "../src/resources/skills/index.js";
import { createCodingAgentInvokeSkillFeature } from "../src/resources/skills/invoke-skill-feature.js";
import type { CodingAgentPromptResourceSource } from "../src/runtime-contracts/prompt-runtime.js";

/**
 * agent_mode 是软引导轴：声明了其他模式的 Skill 依然进 system prompt、依然可被 invoke_skill 调用，
 * 只是排到清单末尾。旧的 fail-closed 实现会让这些用例失败。
 */
describe("agent_mode 对 Skill 的软引导", () => {
	it("system prompt 保留非本模式主推的 Skill，只把它排到末尾", () => {
		const names = promptSkillNames(
			[skill("generic"), skill("coding-only", ["coding"]), skill("work-only", ["work"])],
			"work",
		);

		expect(names).toEqual(["generic", "work-only", "coding-only"]);
	});

	it("空 mode 时保持声明顺序不变", () => {
		const skills = [skill("coding-only", ["coding"]), skill("generic"), skill("work-only", ["work"])];

		expect(promptSkillNames(skills, undefined)).toEqual(["coding-only", "generic", "work-only"]);
	});

	it("未知 mode 下所有 Skill 一律降权到同一桶，顺序保持稳定", () => {
		const skills = [skill("coding-only", ["coding"]), skill("generic"), skill("work-only", ["work"])];
		const first = promptSkillNames(skills, "unknown-mode");

		expect(first).toEqual(["generic", "coding-only", "work-only"]);
		expect(promptSkillNames(skills, "unknown-mode")).toEqual(first);
	});

	it("invoke_skill 仍能调用为其他模式声明的 Skill", async () => {
		const feature = createCodingAgentInvokeSkillFeature({
			resourceSource: resourceSource([skill("coding-only", ["coding"])]),
			readAgentMode: () => "work",
		});

		const result = await feature.tool.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call-1",
			input: { description: "Load coding-only", name: "coding-only" },
			signal: new AbortController().signal,
		});

		expect(JSON.stringify(result.content)).toContain("body of coding-only");
	});
});

function promptSkillNames(skills: readonly Skill[], agentMode: string | undefined): string[] {
	const options = resolveSystemPromptOptionsFromSources(dependencies(skills, agentMode));
	return (options.skills ?? []).map(({ name }) => name);
}

function skill(name: string, agentMode?: string[]): Skill {
	return {
		name,
		description: `${name} skill`,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
		source: "user",
		type: "skill",
		disableModelInvocation: false,
		content: `---\nname: ${name}\ndescription: ${name} skill\n---\nbody of ${name}\n`,
		...(agentMode ? { agentMode } : {}),
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
