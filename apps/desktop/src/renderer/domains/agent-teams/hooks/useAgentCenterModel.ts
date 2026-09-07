import type { AgentProfile, TeamDefinition } from "@vetta/agent-team";
import { useCallback, useMemo, useState } from "react";
import type { AgentCapabilityOption } from "../lib/capability-options";
import {
	assemblyDraftFromTeam,
	assemblyLeaderId,
	canSubmitAssembly,
	emptyAssemblyDraft,
	type TeamAssemblyDraft,
	toggleAssemblyMember,
} from "../lib/team-assembly";
import { type AgentLibraryCopy, type AgentProfileEditInput, useAgentLibraryModel } from "./useAgentLibraryModel";
import { agentTeamErrorMessage, useAgentTeamResources } from "./useAgentTeamResources";
import { useTeamRosterModel } from "./useTeamRosterModel";

/** 侧栏「智能体」入口页同时承载团队编队与智能体库，这里把两块 model 组装成一个 view model。 */
export function useAgentCenterModel(copy: AgentLibraryCopy) {
	const resources = useAgentTeamResources();
	const library = useAgentLibraryModel(resources, copy);
	const roster = useTeamRosterModel(resources, library.libraryAgents);
	const { createAgent } = library.actions;
	const { saveAssembly } = roster.actions;

	/** 有值即处于「拉拢」模式：此时点击智能体卡片是拉入/移出，而不是打开编辑。 */
	const [assembly, setAssembly] = useState<TeamAssemblyDraft>();
	const [selectedTeamId, setSelectedTeamId] = useState<string>();
	const [teamsExpanded, setTeamsExpanded] = useState(false);

	const selectedTeam = useMemo(
		() => roster.teams.find((team) => team.id === selectedTeamId),
		[roster.teams, selectedTeamId],
	);
	const startCreateTeam = useCallback(() => {
		setSelectedTeamId(undefined);
		setAssembly(emptyAssemblyDraft());
	}, []);

	const startEditTeam = useCallback((team: TeamDefinition) => {
		setSelectedTeamId(team.id);
		setAssembly(assemblyDraftFromTeam(team));
	}, []);

	const cancelAssembly = useCallback(() => setAssembly(undefined), []);

	const renameAssembly = useCallback((name: string) => {
		setAssembly((current) => (current ? { ...current, name } : current));
	}, []);

	const promoteAssemblyLeader = useCallback((agentId: string) => {
		setAssembly((current) => (current ? { ...current, leaderId: agentId } : current));
	}, []);

	const submitAssembly = useCallback(async (): Promise<TeamDefinition | undefined> => {
		if (!assembly || !canSubmitAssembly(assembly)) return undefined;
		const saved = await saveAssembly(assembly);
		if (!saved) return undefined;
		setAssembly(undefined);
		setSelectedTeamId(saved.id);
		return saved;
	}, [assembly, saveAssembly]);

	const recruitAgent = useCallback((agent: AgentProfile) => {
		setAssembly((current) => (current ? toggleAssemblyMember(current, agent.id) : current));
	}, []);

	const createAgentFromDraft = useCallback(
		async (input: AgentProfileEditInput): Promise<AgentProfile | undefined> => {
			const created = await createAgent();
			if (!created) return undefined;
			try {
				const updated = await window.vetta.agentTeams.updateAgent(created.id, {
					expectedRevision: created.revision,
					name: input.name.trim() || created.name,
					description: input.description,
					avatar: input.avatar,
					avatarBackground: input.avatarBackground,
					mentionHandle: created.mentionHandle,
					systemPrompt: input.systemPrompt,
					abilities: input.abilities,
				});
				resources.setDocument((current) =>
					current
						? { ...current, agents: current.agents.map((item) => (item.id === updated.id ? updated : item)) }
						: current,
				);
				return updated;
			} catch (cause) {
				resources.setError(agentTeamErrorMessage(cause));
				return undefined;
			}
		},
		[createAgent, resources],
	);

	return {
		loading: resources.loading,
		error: resources.error,
		document: resources.document,
		blueprints: resources.blueprints,
		capabilities: resources.capabilities as readonly AgentCapabilityOption[],
		agents: library.libraryAgents,
		agentsById: roster.agentsById,
		teams: roster.teams,
		teamsExpanded,
		selectedTeam,
		assembly,
		assemblyLeaderId: assembly ? assemblyLeaderId(assembly) : undefined,
		assemblySubmittable: assembly ? canSubmitAssembly(assembly) : false,
		findAgent: (agentId: string) => library.libraryAgents.find((agent) => agent.id === agentId),
		findTeam: (teamId: string) => roster.teams.find((team) => team.id === teamId),
		actions: {
			...library.actions,
			deleteTeam: roster.actions.deleteTeam,
			setTeamsExpanded,
			selectTeam: setSelectedTeamId,
			startCreateTeam,
			startEditTeam,
			cancelAssembly,
			renameAssembly,
			promoteAssemblyLeader,
			submitAssembly,
			recruitAgent,
			saveTeam: roster.actions.saveAssembly,
			createAgentFromDraft,
		},
	};
}

export type AgentCenterModel = ReturnType<typeof useAgentCenterModel>;
