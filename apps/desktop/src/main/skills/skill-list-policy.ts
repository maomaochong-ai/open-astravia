interface ListedSkillCandidate {
	name: string;
	source: string;
}

interface SkillManifestState {
	enabled?: boolean;
}

/**
 * 市场安装项由清单控制，其余来源未登记时直接列出；一旦存在清单记录，启停状态仍以清单为准。
 */
export function shouldListSkill(skill: ListedSkillCandidate, manifestEntry: SkillManifestState | undefined): boolean {
	if (skill.source === "market") return manifestEntry?.enabled ?? false;
	return !manifestEntry || manifestEntry.enabled !== false;
}
