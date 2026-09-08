import {
	type AgentAbilitySelection,
	type AgentProfile,
	type AgentProfileDeleteImpact,
	listLibraryAgentProfiles,
} from "@vetta/agent-team";
import { useCallback, useMemo } from "react";
import { type AgentTeamResources, agentTeamErrorMessage } from "./useAgentTeamResources";

export interface AgentLibraryCopy {
	readonly defaultName: string;
	readonly defaultDescription: string;
}

/** 智能体库的增删改查；团队编队由 `useTeamRosterModel` 负责，两者共用同一份文档状态。 */
export function useAgentLibraryModel(resources: AgentTeamResources, copy: AgentLibraryCopy) {
	const { document, setDocument, blueprints, setError } = resources;

	const libraryAgents = useMemo(() => (document ? listLibraryAgentProfiles(document) : []), [document]);

	const createAgent = useCallback(async (): Promise<AgentProfile | undefined> => {
		const nextBlueprint = blueprints[0];
		if (!nextBlueprint) return undefined;
		try {
			const created = await window.vetta.agentTeams.createAgent({
				name: copy.defaultName,
				description: copy.defaultDescription,
				mentionHandle: `agent-${libraryAgents.length + 1}`,
				blueprintId: nextBlueprint.id,
			});
			setDocument((current) => (current ? { ...current, agents: [...current.agents, created] } : current));
			setError(undefined);
			return created;
		} catch (cause) {
			setError(agentTeamErrorMessage(cause));
			return undefined;
		}
	}, [blueprints, copy.defaultDescription, copy.defaultName, libraryAgents.length, setDocument, setError]);

	const previewAgent = useCallback(async (agentId: string) => {
		return window.vetta.agentTeams.previewAgentUpdate(agentId);
	}, []);

	const previewAgentDelete = useCallback(
		async (agentId: string) => {
			try {
				return await window.vetta.agentTeams.previewAgentDelete(agentId);
			} catch (cause) {
				setError(agentTeamErrorMessage(cause));
				return undefined;
			}
		},
		[setError],
	);

	const saveAgent = useCallback(
		async (agent: AgentProfile, input: AgentProfileEditInput) => {
			const updated = await window.vetta.agentTeams.updateAgent(agent.id, {
				expectedRevision: agent.revision,
				name: input.name,
				description: input.description,
				avatar: input.avatar,
				mentionHandle: input.mentionHandle,
				systemPrompt: input.systemPrompt,
				abilities: input.abilities,
			});
			setDocument((current) =>
				current
					? { ...current, agents: current.agents.map((item) => (item.id === updated.id ? updated : item)) }
					: current,
			);
			return { updated, impact: await previewAgent(agent.id) };
		},
		[previewAgent, setDocument],
	);

	const deleteAgent = useCallback(
		async (agent: AgentProfile, impact: AgentProfileDeleteImpact): Promise<boolean> => {
			try {
				await window.vetta.agentTeams.deleteAgent(agent.id, {
					expectedRevision: agent.revision,
					expectedTeamIds: impact.teams.map((team) => team.teamId),
					expectedTeamRevisions: Object.fromEntries(impact.teams.map((team) => [team.teamId, team.teamRevision])),
				});
				setDocument(await window.vetta.agentTeams.list());
				setError(undefined);
				return true;
			} catch (cause) {
				setError(agentTeamErrorMessage(cause));
				return false;
			}
		},
		[setDocument, setError],
	);

	return {
		libraryAgents,
		actions: { createAgent, previewAgent, previewAgentDelete, saveAgent, deleteAgent },
	};
}

export interface AgentProfileEditInput {
	readonly name: string;
	readonly description: string;
	readonly avatar?: string;
	/** `tint:<preset>` 或 `#rrggbb`；缺省表示按身份自动分配。 */
	readonly mentionHandle: string;
	readonly systemPrompt?: string;
	readonly abilities: AgentAbilitySelection;
}
