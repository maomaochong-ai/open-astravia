import type { AgentProfile, TeamDefinition } from "@vetta/agent-team";
import { useCallback, useMemo } from "react";
import { buildCreateTeamInput, buildUpdateTeamInput, type TeamAssemblyDraft } from "../lib/team-assembly";
import { type AgentTeamResources, agentTeamErrorMessage } from "./useAgentTeamResources";

/** 团队编队的读写；智能体本身的编辑由 `useAgentLibraryModel` 负责。 */
export function useTeamRosterModel(resources: AgentTeamResources, agents: readonly AgentProfile[]) {
	const { document, setDocument, setError, reload } = resources;
	const teams = useMemo(() => document?.teams ?? [], [document]);
	const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

	const saveAssembly = useCallback(
		async (draft: TeamAssemblyDraft): Promise<TeamDefinition | undefined> => {
			const existing = draft.teamId ? teams.find((team) => team.id === draft.teamId) : undefined;
			try {
				const saved = existing
					? await window.vetta.agentTeams.updateTeam(
							existing.id,
							buildUpdateTeamInput(draft, existing, agentsById),
						)
					: await window.vetta.agentTeams.createTeam(buildCreateTeamInput(draft, agentsById));
				setDocument((current) =>
					current
						? {
								...current,
								teams: existing
									? current.teams.map((team) => (team.id === saved.id ? saved : team))
									: [saved, ...current.teams],
							}
						: current,
				);
				setError(undefined);
				return saved;
			} catch (cause) {
				setError(agentTeamErrorMessage(cause));
				return undefined;
			}
		},
		[agentsById, setDocument, setError, teams],
	);

	const deleteTeam = useCallback(
		async (team: TeamDefinition): Promise<boolean> => {
			try {
				await window.vetta.agentTeams.deleteTeam(team.id, { expectedRevision: team.revision });
				await reload();
				return true;
			} catch (cause) {
				setError(agentTeamErrorMessage(cause));
				return false;
			}
		},
		[reload, setError],
	);

	return { teams, agentsById, actions: { saveAssembly, deleteTeam } };
}
