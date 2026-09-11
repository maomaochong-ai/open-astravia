import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";
import type { AgentProfile, AgentTeamDocument } from "@vetta/agent-team";
import type { NewSessionHeroAvatar, NewSessionHeroIdentity } from "@vetta/theme-ui";
import { parseAgentTargetKey, parseTeamTargetKey } from "./target";

export interface NewSessionTargetIdentityLabels {
	/** 团队没写描述时的兜底副标题（成员数）。 */
	readonly memberCount: (count: number) => string;
}

/** 解析档案头像；缺省只认用户自己挑的图，提供方那张要靠调用方传解析器进来。 */
export type NewSessionAvatarResolver = (subject: {
	readonly id: string;
	readonly blueprintId: string;
	readonly avatar?: string;
}) => string;

/**
 * 把选中的会话对象解析成 hero 身份。
 *
 * 目标档案可能已被删除（URL 里带着旧 target 进来，或另一个窗口刚删掉它），
 * 这时返回 null 让 hero 回到问候语，而不是显示一个空壳身份。
 */
export function resolveNewSessionTargetIdentity(
	document: AgentTeamDocument | undefined,
	targetKey: string | null,
	labels: NewSessionTargetIdentityLabels,
	resolveAvatar: NewSessionAvatarResolver = agentAvatarUrl,
): NewSessionHeroIdentity | null {
	if (!document || !targetKey) return null;

	const teamId = parseTeamTargetKey(targetKey);
	if (teamId) {
		const team = document.teams.find((candidate) => candidate.id === teamId);
		if (!team) return null;
		const agentsById = new Map(document.agents.map((agent) => [agent.id, agent]));
		return {
			avatars: team.members.map((member) =>
				heroAvatar(agentsById.get(member.binding.agentProfileId), member.id, resolveAvatar),
			),
			key: targetKey,
			subtitle: team.description.trim() || labels.memberCount(team.members.length),
			title: team.name,
		};
	}

	const agentId = parseAgentTargetKey(targetKey);
	if (agentId) {
		const agent = document.agents.find((candidate) => candidate.id === agentId);
		if (!agent) return null;
		return {
			avatars: [heroAvatar(agent, agent.id, resolveAvatar)],
			key: targetKey,
			subtitle: agent.description.trim(),
			title: agent.name,
		};
	}

	return null;
}

/** 成员绑定指向的档案可能缺失（团队私有副本被清理）：退回 member id 的兜底头像。 */
function heroAvatar(
	profile: AgentProfile | undefined,
	fallbackId: string,
	resolveAvatar: NewSessionAvatarResolver,
): NewSessionHeroAvatar {
	return {
		avatar: resolveAvatar({
			id: profile?.id ?? fallbackId,
			blueprintId: profile?.blueprintId ?? "",
			...(profile?.avatar ? { avatar: profile.avatar } : {}),
		}),
		...(profile?.blueprintId ? { blueprintId: profile.blueprintId } : {}),
		name: profile?.name ?? fallbackId,
	};
}
