import type {
	AgentProfile,
	AgentProfileDeleteImpact,
	AgentProfileUpdateImpact,
	AgentTeamDocument,
	TeamDefinition,
	TeamMember,
} from "./contracts.js";
import { DEFAULT_AGENT_TEAM_EXTENSIONS } from "./extensions.js";

export function normalizeMentionHandle(value: string): string {
	return value.normalize("NFKC").trim().replace(/^@+/, "").toLocaleLowerCase("en-US");
}
export function resolveTeamTargets(team: TeamDefinition, requestedMemberIds: readonly string[]): readonly string[] {
	const policy = DEFAULT_AGENT_TEAM_EXTENSIONS.orchestrationPolicies.get(team.orchestrationPolicyId);
	if (!policy) throw new Error(`Unknown team orchestration policy: ${team.orchestrationPolicyId}`);
	return policy.resolveTargets({ team, requestedMemberIds });
}
export function resolveMemberByHandle(team: TeamDefinition, handle: string): TeamMember | undefined {
	const normalized = normalizeMentionHandle(handle);
	return team.members.find((member) => normalizeMentionHandle(member.handle) === normalized);
}
export function resolveMentionedMemberIds(
	team: TeamDefinition,
	text: string,
	explicitMemberIds: readonly string[] = [],
): readonly string[] {
	const memberByHandle = new Map(team.members.map((member) => [normalizeMentionHandle(member.handle), member.id]));
	const ids = new Set(explicitMemberIds);
	for (const match of text.matchAll(/(?:^|\s)@([^\s@]+)/gu)) {
		const memberId = memberByHandle.get(normalizeMentionHandle(match[1] ?? ""));
		if (memberId) ids.add(memberId);
	}
	return [...ids];
}
export function resolveMemberProfile(document: Pick<AgentTeamDocument, "agents">, member: TeamMember): AgentProfile {
	const profile = document.agents.find((candidate) => candidate.id === member.binding.agentProfileId);
	if (!profile) throw new Error(`Agent profile not found: ${member.binding.agentProfileId}`);
	return profile;
}
export function previewAgentProfileUpdate(
	document: Pick<AgentTeamDocument, "teams">,
	agentProfileId: string,
): AgentProfileUpdateImpact {
	const affected = document.teams.filter((team) =>
		team.members.some(
			(member) => member.binding.kind === "reference" && member.binding.agentProfileId === agentProfileId,
		),
	);
	return { agentProfileId, teamIds: affected.map((team) => team.id), teamNames: affected.map((team) => team.name) };
}

export function previewAgentProfileDelete(
	document: Pick<AgentTeamDocument, "agents" | "teams">,
	agentProfileId: string,
): AgentProfileDeleteImpact {
	const teams = document.teams.flatMap((team) => {
		const removed = team.members.filter(
			(member) => member.binding.kind === "reference" && member.binding.agentProfileId === agentProfileId,
		);
		if (removed.length === 0) return [];
		const removedIds = new Set(removed.map((member) => member.id));
		const remaining = team.members.filter((member) => !removedIds.has(member.id));
		const currentLeaderRemoved = removedIds.has(team.leaderMemberId);
		const nextLeader = currentLeaderRemoved ? remaining[0] : undefined;
		const nextLeaderProfile = nextLeader
			? document.agents.find((agent) => agent.id === nextLeader.binding.agentProfileId)
			: undefined;
		return [
			{
				teamId: team.id,
				teamRevision: team.revision,
				teamName: team.name,
				removedMemberIds: removed.map((member) => member.id),
				deletesTeam: remaining.length === 0,
				...(nextLeader
					? {
							nextLeaderMemberId: nextLeader.id,
							nextLeaderName: nextLeaderProfile?.name ?? nextLeader.handle,
						}
					: {}),
			},
		];
	});
	return { agentProfileId, teams };
}
export function listLibraryAgentProfiles(document: Pick<AgentTeamDocument, "agents">): readonly AgentProfile[] {
	return document.agents.filter((agent) => agent.scope.kind === "library");
}
export function assertTeamInvariants(team: TeamDefinition, agents: readonly AgentProfile[]): void {
	if (team.members.length === 0) throw new Error("A team must contain at least one member");
	if (!team.members.some((member) => member.id === team.leaderMemberId))
		throw new Error("The team leader must be one of the members");
	const ids = new Set<string>();
	const handles = new Set<string>();
	for (const member of team.members) {
		if (ids.has(member.id)) throw new Error(`Duplicate team member id: ${member.id}`);
		ids.add(member.id);
		const handle = normalizeMentionHandle(member.handle);
		if (!handle) throw new Error("Team member handle must not be empty");
		if (handles.has(handle)) throw new Error(`Duplicate team member handle: ${member.handle}`);
		handles.add(handle);
		const profile = agents.find((candidate) => candidate.id === member.binding.agentProfileId);
		if (!profile) throw new Error(`Agent profile not found: ${member.binding.agentProfileId}`);
		if (member.binding.kind === "copy" && (profile.scope.kind !== "team" || profile.scope.teamId !== team.id))
			throw new Error(`Copied member profile must belong to team: ${profile.id}`);
		if (member.binding.kind === "reference" && profile.scope.kind !== "library")
			throw new Error(`Referenced member profile must belong to the agent library: ${profile.id}`);
	}
}
