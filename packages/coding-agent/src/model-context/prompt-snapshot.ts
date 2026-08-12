import { readSkillContent, type Skill } from "../resources/skills/index.js";
import type { CodingAgentPromptResourceSource, CodingAgentPromptSettingsSource } from "../runtime-contracts/index.js";

/**
 * Turn admission 时把文件型 Prompt/Skill 来源转换为只读内存视图。
 * Skill 正文也在这里读取，避免 invoke_skill 在 Turn 中再次按路径读取新文件。
 */
export function capturePromptResourceSource(source: CodingAgentPromptResourceSource): CodingAgentPromptResourceSource {
	source.refreshContextResourcesIfChanged();
	const agentsFiles = source
		.getAgentsFiles()
		.agentsFiles.map((file) => Object.freeze({ path: file.path, content: file.content }));
	const skills = capturePromptSkills(source);
	const systemPrompt = source.getSystemPrompt();
	const appendSystemPrompt = Object.freeze([...source.getAppendSystemPrompt()]);

	return Object.freeze({
		getAgentsFiles: () => ({ agentsFiles: [...agentsFiles] }),
		getAppendSystemPrompt: () => [...appendSystemPrompt],
		getSkills: () => ({ skills: [...skills], diagnostics: [] }),
		getSystemPrompt: () => systemPrompt,
		refreshContextResourcesIfChanged: () => false,
		refreshSkillsIfChanged: () => false,
		setRuntimeSkillPaths: () => {},
	});
}

export function capturePromptSkills(
	source: Pick<CodingAgentPromptResourceSource, "getSkills" | "refreshSkillsIfChanged">,
): readonly Skill[] {
	source.refreshSkillsIfChanged();
	return Object.freeze(source.getSkills().skills.map(captureSkill));
}

export function capturePromptSettingsSource(source: CodingAgentPromptSettingsSource): CodingAgentPromptSettingsSource {
	source.reloadPersonalizationSettings();
	const personalization = Object.freeze({ ...source.getPersonalization() });
	const blockImages = source.getBlockImages?.();
	return Object.freeze({
		getPersonalization: () => personalization,
		getBlockImages: blockImages === undefined ? undefined : () => blockImages,
		reloadImageSettings: () => {},
		reloadPersonalizationSettings: () => {},
	});
}

function captureSkill(skill: Skill): Skill {
	const captured: Skill = {
		...skill,
		...(skill.agentMode ? { agentMode: [...skill.agentMode] } : {}),
		content: readSkillContent(skill),
		...(skill.type === "scene" ? { sceneTasks: readSceneTasks(skill) } : {}),
	};
	return Object.freeze(captured);
}

function readSceneTasks(skill: Skill): readonly string[] {
	const path = join(skill.baseDir, "tasks.json");
	if (!existsSync(path)) return Object.freeze([]);
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
		return Array.isArray(value) && value.every((task) => typeof task === "string")
			? Object.freeze([...value])
			: Object.freeze([]);
	} catch {
		return Object.freeze([]);
	}
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
