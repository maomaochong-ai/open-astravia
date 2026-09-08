import type { AgentProfile, TeamDefinition } from "@vetta/agent-team";

const AVATAR_DIRECTORY = "./agent-team-avatars";

/**
 * 内置头像目录：文件名即角色名，让 blueprint 与画面一一对应。
 * 这些路径会写进 Agent 档案并跨版本留存，改名等于让老档案指向 404。
 */
export const AGENT_AVATAR_OPTIONS = Object.freeze(
	["master", "researcher", "architect", "executor", "auditor", "optimizer", "synthesizer", "translator", "router"].map(
		(role) => `${AVATAR_DIRECTORY}/${role}.webp`,
	),
);

const BLUEPRINT_AVATAR: Readonly<Record<string, string>> = Object.freeze({
	master: `${AVATAR_DIRECTORY}/master.webp`,
	researcher: `${AVATAR_DIRECTORY}/researcher.webp`,
	architect: `${AVATAR_DIRECTORY}/architect.webp`,
	executor: `${AVATAR_DIRECTORY}/executor.webp`,
	auditor: `${AVATAR_DIRECTORY}/auditor.webp`,
	optimizer: `${AVATAR_DIRECTORY}/optimizer.webp`,
	synthesizer: `${AVATAR_DIRECTORY}/synthesizer.webp`,
	translator: `${AVATAR_DIRECTORY}/translator.webp`,
	// 旧 blueprint 仍可能留在用户档案里，映射到接替它的新角色画面。
	leader: `${AVATAR_DIRECTORY}/master.webp`,
	builder: `${AVATAR_DIRECTORY}/executor.webp`,
	reviewer: `${AVATAR_DIRECTORY}/auditor.webp`,
});

/**
 * 编号命名的老头像已随本次改版下线，用户档案里存的旧路径要落到新画面上，
 * 否则界面上会出现一格裂图。序号沿用旧目录顺序：01 是队长，其余按角色补位。
 */
const LEGACY_AVATAR_ALIASES: Readonly<Record<string, string>> = Object.freeze(
	Object.fromEntries(
		AGENT_AVATAR_OPTIONS.map((avatar, index) => [
			`${AVATAR_DIRECTORY}/avatar-${String(index + 1).padStart(2, "0")}.webp`,
			avatar,
		]),
	),
);

/** Returns a stable built-in avatar for profiles that have no custom selection. */
export function agentAvatarUrl(profile: {
	readonly id: string;
	readonly blueprintId: string;
	readonly avatar?: string;
}): string {
	if (profile.avatar) return LEGACY_AVATAR_ALIASES[profile.avatar] ?? profile.avatar;
	return BLUEPRINT_AVATAR[profile.blueprintId] ?? AGENT_AVATAR_OPTIONS[stableIndex(profile.id)]!;
}

export function teamMemberAvatarUrls(
	team: TeamDefinition,
	agentsById: ReadonlyMap<string, AgentProfile>,
): readonly string[] {
	return team.members.map((member) => {
		const profile = agentsById.get(member.binding.agentProfileId);
		return agentAvatarUrl({
			id: profile?.id ?? member.id,
			blueprintId: profile?.blueprintId ?? "master",
			...(profile?.avatar ? { avatar: profile.avatar } : {}),
		});
	});
}

function stableIndex(value: string): number {
	let hash = 0;
	for (const character of value) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
	return hash % AGENT_AVATAR_OPTIONS.length;
}
