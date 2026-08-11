/** Minimal product-facing skill data required to render the model-visible skill index. */
export interface ProductPromptSkill {
	readonly name: string;
	readonly description: string;
	readonly type: "skill" | "scene";
	readonly disableModelInvocation: boolean;
}

/** Format model-invocable skills using the Agent Skills XML prompt contract. */
export function formatSkillsForProductPrompt(skills: readonly ProductPromptSkill[]): string {
	const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation && skill.type !== "scene");
	if (visibleSkills.length === 0) return "";

	const lines = [
		"\n\n# Skills",
		"",
		"When the user's request matches a skill below, you MUST call the invoke_skill tool with the skill's name BEFORE attempting to handle the task yourself.",
		"This is a BLOCKING REQUIREMENT. Do NOT try to accomplish the task manually when a matching skill exists.",
		"NEVER use bash commands like find, locate, or mdfind to search for skill files. Always use the invoke_skill tool.",
		"",
		"<available_skills>",
	];
	for (const skill of visibleSkills) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(skill.description)}</description>`);
		lines.push("  </skill>");
	}
	lines.push("</available_skills>");
	return lines.join("\n");
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
