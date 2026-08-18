interface ListedSkillCandidate {
	name: string;
	source: string;
}

interface SkillManifestState {
	enabled?: boolean;
}

/**
 * 市场安装项由清单控制；scene 目录也允许用户直接维护，未登记时按本地只读资源列出。
 * 一旦存在清单记录，启停状态仍以清单为准。
 */
export function shouldListSkill(skill: ListedSkillCandidate, manifestEntry: SkillManifestState | undefined): boolean {
	if (skill.source === "market") return manifestEntry?.enabled ?? false;
	if (skill.source === "scene") return manifestEntry?.enabled ?? true;
	return !manifestEntry || manifestEntry.enabled !== false;
}
