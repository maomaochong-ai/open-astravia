import type { AgentProfile, TeamDefinition } from "@vetta/agent-team";
import { PRESET_AGENT_PLUGIN_ID, pluginBlueprintId } from "@vetta/agent-team";

const AVATAR_DIRECTORY = "./agent-team-avatars";

/** 新增角色一律追加在末尾：LEGACY_AVATAR_ALIASES 按下标还原老档案里的 avatar-NN 路径。 */
export const AGENT_AVATAR_OPTIONS = Object.freeze(
	["master", "researcher", "architect", "executor", "auditor", "optimizer", "synthesizer", "translator", "router"].map(
		(role) => `${AVATAR_DIRECTORY}/${role}.webp`,
	),
);

const BLUEPRINT_AVATAR: Readonly<Record<string, string>> = Object.freeze({
	// master / developer / researcher 的人设搬去了「预设智能体」插件，头像仍用宿主这套图：
	// 插件不自带头像，缺了这三条映射就会回落到按 id 取的随机图。
	[pluginBlueprintId(PRESET_AGENT_PLUGIN_ID, "master")]: `${AVATAR_DIRECTORY}/master.webp`,
	[pluginBlueprintId(PRESET_AGENT_PLUGIN_ID, "developer")]: `${AVATAR_DIRECTORY}/executor.webp`,
	[pluginBlueprintId(PRESET_AGENT_PLUGIN_ID, "researcher")]: `${AVATAR_DIRECTORY}/researcher.webp`,
	master: `${AVATAR_DIRECTORY}/master.webp`,
	researcher: `${AVATAR_DIRECTORY}/researcher.webp`,
	architect: `${AVATAR_DIRECTORY}/architect.webp`,
	executor: `${AVATAR_DIRECTORY}/executor.webp`,
	auditor: `${AVATAR_DIRECTORY}/auditor.webp`,
	optimizer: `${AVATAR_DIRECTORY}/optimizer.webp`,
	synthesizer: `${AVATAR_DIRECTORY}/synthesizer.webp`,
	translator: `${AVATAR_DIRECTORY}/translator.webp`,
	leader: `${AVATAR_DIRECTORY}/master.webp`,
	builder: `${AVATAR_DIRECTORY}/executor.webp`,
	reviewer: `${AVATAR_DIRECTORY}/auditor.webp`,
});

const LEGACY_AVATAR_ALIASES: Readonly<Record<string, string>> = Object.freeze(
	Object.fromEntries(
		AGENT_AVATAR_OPTIONS.map((avatar, index) => [
			`${AVATAR_DIRECTORY}/avatar-${String(index + 1).padStart(2, "0")}.webp`,
			avatar,
		]),
	),
);

export function agentAvatarUrl(
	profile: {
		readonly id: string;
		readonly blueprintId: string;
		readonly avatar?: string;
	},
	/** 插件贡献的 blueprint 自带头像；宿主的内置图里没有它。 */
	blueprint?: { readonly avatarUrl?: string },
): string {
	if (profile.avatar) return LEGACY_AVATAR_ALIASES[profile.avatar] ?? profile.avatar;
	if (blueprint?.avatarUrl) return blueprint.avatarUrl;
	return BLUEPRINT_AVATAR[profile.blueprintId] ?? AGENT_AVATAR_OPTIONS[stableIndex(profile.id)]!;
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
				blueprintId: profile?.blueprintId ?? "master",
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
