import { CLAUDE_CODE_HOOK_PROFILE_ID, type EcosystemHookContributionSource } from "@vetta/ecosystem-adapter";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import type { Skill, SkillFrontmatter } from "./index.js";

export interface SkillInvocationDocument {
	readonly body: string;
	readonly hooks?: unknown;
	readonly revision: string;
}

export function readSkillInvocationDocument(skill: Skill): SkillInvocationDocument {
	const content = skill.content;
	const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(content);
	return {
		body,
		hooks: frontmatter.hooks,
		revision: createSkillContentRevision(content),
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
		env: {
			CLAUDE_PLUGIN_ROOT: skill.baseDir,
			CLAUDE_SKILL_DIR: skill.baseDir,
		},
	};
}

/** Internal change detector for an already-materialized Skill document; this is not a security digest. */
function createSkillContentRevision(content: string): string {
	let first = 0x811c9dc5;
	let second = 0x9e3779b9;
	for (let index = 0; index < content.length; index += 1) {
		const codeUnit = content.charCodeAt(index);
		first = Math.imul(first ^ codeUnit, 0x01000193);
		second = Math.imul(second ^ (codeUnit + index), 0x27d4eb2d);
	}
	return `${content.length.toString(16)}-${toHex(first)}${toHex(second)}`;
}

function toHex(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
