import { readSkillContent, type Skill } from "../resources/skills/index.js";
import type { CodingAgentPromptResourceSource, CodingAgentPromptSettingsSource } from "../runtime-contracts/index.js";

/**
 * Turn admission 时把文件型 Prompt/Skill 来源转换为只读内存视图。
 * Skill 正文也在这里读取，避免 invoke_skill 在 Turn 中再次按路径读取新文件。
 */
export function capturePromptResourceSource(source: CodingAgentPromptResourceSource): CodingAgentPromptResourceSource {
	source.refreshContextResourcesIfChanged();
	source.refreshSkillsIfChanged();
	const agentsFiles = source
		.getAgentsFiles()
		.agentsFiles.map((file) => Object.freeze({ path: file.path, content: file.content }));
	const skills = source.getSkills().skills.map(captureSkill);
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
	};
	return Object.freeze(captured);
}
