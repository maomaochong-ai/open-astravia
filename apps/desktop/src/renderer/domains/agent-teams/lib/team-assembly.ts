import type {
	AgentProfile,
	CreateTeamInput,
	CreateTeamMemberInput,
	TeamDefinition,
	UpdateTeamInput,
	UpdateTeamMemberInput,
} from "@vetta/agent-team";

/**
 * 「拉拢」编队时的草稿。它只按 Agent 身份记录阵容，成员绑定与 leader 归属
 * 在提交时才折算成 Team 协议输入，避免 UI state 混入协议细节。
 */
export interface TeamAssemblyDraft {
	/** 有值表示在改已有团队的阵容，无值表示新建。 */
	readonly teamId?: string;
	readonly name: string;
	readonly description?: string;
	readonly memberIds: readonly string[];
	/** 队长的 Agent Profile ID；成员被移除时自动顺延到第一位。 */
	readonly leaderId?: string;
	/** 新成员的绑定方式，缺省为跟随智能体库的 `reference`。 */
	readonly bindingKinds?: Readonly<Record<string, "reference" | "copy">>;
}

export function emptyAssemblyDraft(): TeamAssemblyDraft {
	return { name: "", memberIds: [], leaderId: undefined };
}

export function assemblyDraftFromTeam(team: TeamDefinition): TeamAssemblyDraft {
	const memberIds = team.members.map((member) => member.binding.agentProfileId);
	const leader = team.members.find((member) => member.id === team.leaderMemberId);
	return {
		teamId: team.id,
		name: team.name,
		description: team.description,
		memberIds,
		leaderId: leader?.binding.agentProfileId ?? memberIds[0],
	};
}

/** 点击卡片即拉入或移出；移出队长时把队长顺延给剩下的第一位。 */
export function toggleAssemblyMember(draft: TeamAssemblyDraft, agentId: string): TeamAssemblyDraft {
	if (!draft.memberIds.includes(agentId)) {
		return {
			...draft,
			memberIds: [...draft.memberIds, agentId],
			leaderId: draft.leaderId ?? agentId,
		};
	}
	const memberIds = draft.memberIds.filter((id) => id !== agentId);
	return {
		...draft,
		memberIds,
		leaderId: draft.leaderId === agentId ? memberIds[0] : draft.leaderId,
	};
}

export function assemblyLeaderId(draft: TeamAssemblyDraft): string | undefined {
	return draft.leaderId && draft.memberIds.includes(draft.leaderId) ? draft.leaderId : draft.memberIds[0];
}

export function canSubmitAssembly(draft: TeamAssemblyDraft): boolean {
	return draft.name.trim().length > 0 && draft.memberIds.length > 0;
}

export function buildCreateTeamInput(
	draft: TeamAssemblyDraft,
	agentsById: ReadonlyMap<string, AgentProfile>,
): CreateTeamInput {
	const leaderId = assemblyLeaderId(draft);
	const members: CreateTeamMemberInput[] = [];
	const usedHandles = new Set<string>();
	for (const agentId of draft.memberIds) {
		const agent = agentsById.get(agentId);
		if (!agent) continue;
		members.push({
			agentProfileId: agent.id,
			handle: uniqueHandle(agent.mentionHandle, usedHandles),
			bindingKind: bindingKindFor(draft, agent.id),
			leader: agent.id === leaderId,
		});
	}
	return { name: draft.name.trim(), description: draft.description?.trim() ?? "", members };
}

export function buildUpdateTeamInput(
	draft: TeamAssemblyDraft,
	team: TeamDefinition,
	agentsById: ReadonlyMap<string, AgentProfile>,
): UpdateTeamInput {
	const leaderId = assemblyLeaderId(draft);
	const existingByAgentId = new Map(team.members.map((member) => [member.binding.agentProfileId, member]));
	const members: UpdateTeamMemberInput[] = [];
	for (const agentId of draft.memberIds) {
		if (!agentsById.has(agentId)) continue;
		const existing = existingByAgentId.get(agentId);
		members.push(
			existing
				? { kind: "existing", memberId: existing.id, leader: agentId === leaderId }
				: {
						kind: "new",
						agentProfileId: agentId,
						bindingKind: bindingKindFor(draft, agentId),
						leader: agentId === leaderId,
					},
		);
	}
	return {
		expectedRevision: team.revision,
		name: draft.name.trim(),
		description: draft.description?.trim() ?? team.description,
		members,
	};
}

function bindingKindFor(draft: TeamAssemblyDraft, agentId: string): "reference" | "copy" {
	return draft.bindingKinds?.[agentId] ?? "reference";
}

function uniqueHandle(handle: string, used: Set<string>): string {
	let candidate = handle;
	for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${handle}-${suffix}`;
	used.add(candidate);
	return candidate;
}
