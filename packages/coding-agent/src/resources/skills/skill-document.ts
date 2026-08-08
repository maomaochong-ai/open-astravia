import { createHash } from "node:crypto";
import { CLAUDE_CODE_HOOK_PROFILE_ID, type EcosystemHookContributionSource } from "@vetta/ecosystem-adapter";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { readSkillContent, type Skill, type SkillFrontmatter } from "./index.js";

export interface SkillInvocationDocument {
	readonly body: string;
	readonly hooks?: unknown;
	readonly revision: string;
}

export function readSkillInvocationDocument(skill: Skill): SkillInvocationDocument {
	const content = readSkillContent(skill);
	const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(content);
	return {
		body,
		hooks: frontmatter.hooks,
		revision: createHash("sha256").update(content).digest("hex"),
	};
}

export function createSkillHookContribution(
	skill: Skill,
	document: SkillInvocationDocument,
): EcosystemHookContributionSource | undefined {
	if (document.hooks === undefined) return undefined;
	return {
		id: `skill:${skill.filePath}`,
		revision: document.revision,
		profileId: CLAUDE_CODE_HOOK_PROFILE_ID,
		sourcePath: skill.filePath,
		configuration: document.hooks,
		env: { CLAUDE_SKILL_DIR: skill.baseDir },
	};
}
