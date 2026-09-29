import type { RemoteSkillOption } from "@vetta/remote-control";
import {
	getSkillDisplayDescription,
	getSkillDisplayName,
	isSkillVisibleOnSurface,
	SKILL_PRESENTATION_SURFACES,
} from "@vetta-org/capability-sdk";
import { type SkillUsageMap, sortSkillsForPanel } from "../../shared/skill-ranking.js";
import type { ListedSkill } from "../skills/skill-service.js";

const MAX_SKILLS = 500;
const MAX_DESCRIPTION_LENGTH = 400;

/**
 * The phone's skill picker shows what the desktop composer's picker shows:
 * the same visibility rules and the same usage-first order. Only the fields
 * the phone renders travel; icons and plugin ids stay on the desktop.
 */
export function toRemoteSkillOptions(skills: readonly ListedSkill[], usage: SkillUsageMap): RemoteSkillOption[] {
	const visible = skills
		.filter((skill) => isSkillVisibleOnSurface(skill, SKILL_PRESENTATION_SURFACES.SKILL_PICKER))
		.map((skill) => ({ ...skill, alias: getSkillDisplayName(skill) }));
	return sortSkillsForPanel(visible, usage)
		.slice(0, MAX_SKILLS)
		.map((skill) => {
			const description = getSkillDisplayDescription(skill).trim();
			return {
				name: skill.name,
				...(skill.alias && skill.alias !== skill.name ? { alias: skill.alias } : {}),
				description:
					description.length > MAX_DESCRIPTION_LENGTH
						? `${description.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
						: description,
				type: skill.type,
				source: skill.source,
			};
		});
}
