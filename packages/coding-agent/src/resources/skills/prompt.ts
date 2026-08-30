import { SKILL_SELECTION_GUIDANCE } from "./usage-guidance.js";

/** Minimal skill data required by the model-visible index. */
export interface ModelVisibleSkill {
	readonly name: string;
	readonly description: string;
	readonly type: "skill" | "scene";
	readonly disableModelInvocation: boolean;
}

/** Format model-visible skills using the Agent Skills XML convention. */
export function formatSkillsForPrompt(skills: readonly ModelVisibleSkill[]): string {
	const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation && skill.type !== "scene");
	if (visibleSkills.length === 0) return "";
	const lines = [
		"\n\n# Skills",
		"",
		SKILL_SELECTION_GUIDANCE,
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
