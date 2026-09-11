import type { AgentProfile, TeamDefinition } from "@vetta/agent-team";

const AVATAR_DIRECTORY = "./agent-team-avatars";

/** 新增角色一律追加在末尾：LEGACY_AVATAR_ALIASES 按下标还原老档案里的 avatar-NN 路径。 */
export const AGENT_AVATAR_OPTIONS = Object.freeze(
	["master", "researcher", "architect", "executor", "auditor", "optimizer", "synthesizer", "translator", "router"].map(
		(role) => `${AVATAR_DIRECTORY}/${role}.webp`,
	),
);

/** 老档案里存的是 avatar-NN 路径，按下标还原成现在的文件名。 */
const LEGACY_AVATAR_ALIASES: Readonly<Record<string, string>> = Object.freeze(
	Object.fromEntries(
		AGENT_AVATAR_OPTIONS.map((avatar, index) => [
			`${AVATAR_DIRECTORY}/avatar-${String(index + 1).padStart(2, "0")}.webp`,
			avatar,
		]),
	),
);

/**
 * 档案头像：用户选过的优先，其次是提供方给 blueprint 配的图。
 *
 * 都没有时按档案 id 稳定取一张兜底——宿主不认识任何具体角色，也就没有「这个角色该用哪张图」
 * 这回事。
 */
export function agentAvatarUrl(
	profile: {
		readonly id: string;
		readonly avatar?: string;
	},
	/** 提供方随 blueprint 带来的头像。 */
	blueprint?: { readonly avatarUrl?: string },
): string {
	if (profile.avatar) return LEGACY_AVATAR_ALIASES[profile.avatar] ?? profile.avatar;
	if (blueprint?.avatarUrl) return blueprint.avatarUrl;
	return AGENT_AVATAR_OPTIONS[stableIndex(profile.id)]!;
}

export function teamMemberAvatarUrls(
	team: TeamDefinition,
	agentsById: ReadonlyMap<string, AgentProfile>,
	blueprintsById?: ReadonlyMap<string, { readonly avatarUrl?: string }>,
): readonly string[] {
	return team.members.map((member) => {
		const profile = agentsById.get(member.binding.agentProfileId);
		return agentAvatarUrl(
			{
				id: profile?.id ?? member.id,
				...(profile?.avatar ? { avatar: profile.avatar } : {}),
			},
			profile ? blueprintsById?.get(profile.blueprintId) : undefined,
		);
	});
}

function stableIndex(value: string): number {
	let hash = 0;
	for (const character of value) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
	return hash % AGENT_AVATAR_OPTIONS.length;
}
