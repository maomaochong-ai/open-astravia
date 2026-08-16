import type { Skill } from "../resources/skills/index.js";
import type { CodingAgentPromptResourceSource, CodingAgentPromptSettingsSource } from "../runtime-contracts/index.js";

/**
 * Turn admission 时把已物化的 Prompt/Skill generation 转换为只读内存视图。
 * Skill 正文与 Scene tasks 已在资源刷新阶段读取，本层只冻结当前 Turn 的版本。
 */
export async function capturePromptResourceSource(
	source: CodingAgentPromptResourceSource,
	signal?: AbortSignal,
): Promise<CodingAgentPromptResourceSource> {
	await source.refreshContextResourcesIfChanged(signal);
	const agentsFiles = source
		.getAgentsFiles()
		.agentsFiles.map((file) => Object.freeze({ path: file.path, content: file.content }));
	const skills = await capturePromptSkills(source, signal);
	const systemPrompt = source.getSystemPrompt();
	const appendSystemPrompt = Object.freeze([...source.getAppendSystemPrompt()]);

	return Object.freeze({
		getAgentsFiles: () => ({ agentsFiles: [...agentsFiles] }),
		getAppendSystemPrompt: () => [...appendSystemPrompt],
		getSkills: () => ({ skills: [...skills], diagnostics: [] }),
		getSystemPrompt: () => systemPrompt,
		refreshContextResourcesIfChanged: async () => false,
		refreshSkillsIfChanged: async () => false,
		setRuntimeSkillPaths: async () => {},
	});
}

export async function capturePromptSkills(
	source: Pick<CodingAgentPromptResourceSource, "getSkills" | "refreshSkillsIfChanged">,
	signal?: AbortSignal,
): Promise<readonly Skill[]> {
	await source.refreshSkillsIfChanged(signal);
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
		sceneTasks: Object.freeze([...skill.sceneTasks]),
	};
	return Object.freeze(captured);
}
