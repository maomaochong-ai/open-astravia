import type {
	AgentProfile,
	CreateTeamInput,
	CreateTeamMemberInput,
	TeamDefinition,
	TeamMemberAssignment,
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
	/** 成员在本团队内的任务书，按 Agent 身份存放；空白字段由主进程折算成缺省。 */
	readonly assignments?: Readonly<Record<string, TeamMemberAssignment>>;
}

export function emptyAssemblyDraft(): TeamAssemblyDraft {
	return { name: "", memberIds: [], leaderId: undefined };
}

export function assemblyDraftFromTeam(team: TeamDefinition): TeamAssemblyDraft {
	const memberIds = team.members.map((member) => member.binding.agentProfileId);
	const leader = team.members.find((member) => member.id === team.leaderMemberId);
	const assignments = Object.fromEntries(
		team.members.flatMap((member) => (member.assignment ? [[member.binding.agentProfileId, member.assignment]] : [])),
	);
	return {
		teamId: team.id,
		name: team.name,
		description: team.description,
		memberIds,
		leaderId: leader?.binding.agentProfileId ?? memberIds[0],
		assignments,
	};
}

/** 写入或清空某位成员的任务书；两个字段都空时整条移除，草稿里不留空壳。 */
export function setAssemblyAssignment(
	draft: TeamAssemblyDraft,
	agentId: string,
	assignment: TeamMemberAssignment,
): TeamAssemblyDraft {
	const responsibility = assignment.responsibility?.trim();
	const instructions = assignment.instructions?.trim();
	const { [agentId]: _removed, ...rest } = draft.assignments ?? {};
	if (!responsibility && !instructions) return { ...draft, assignments: rest };
	return {
		...draft,
		assignments: {
			...rest,
			[agentId]: { ...(responsibility ? { responsibility } : {}), ...(instructions ? { instructions } : {}) },
		},
	};
}

export function assemblyAssignment(draft: TeamAssemblyDraft, agentId: string): TeamMemberAssignment | undefined {
	return draft.assignments?.[agentId];
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
			...(draft.assignments?.[agent.id] ? { assignment: draft.assignments[agent.id] } : {}),
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
				? {
						kind: "existing",
						memberId: existing.id,
						leader: agentId === leaderId,
						...assignmentInput(draft, agentId),
					}
				: {
						kind: "new",
						agentProfileId: agentId,
						bindingKind: bindingKindFor(draft, agentId),
						leader: agentId === leaderId,
						...assignmentInput(draft, agentId),
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

/**
 * 改团队时任务书始终随编队一起提交：草稿里没有就发空对象表示「清空」。
 * 省略字段在协议里表示「本次没碰任务书」，会让删除任务书永远保存不上。
 */
function assignmentInput(draft: TeamAssemblyDraft, agentId: string): { readonly assignment: TeamMemberAssignment } {
	return { assignment: draft.assignments?.[agentId] ?? {} };
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
