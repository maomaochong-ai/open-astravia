import type { AgentProfile, TeamDefinition } from "@vetta/agent-team";
import type { TFunction } from "i18next";

/** Names and descriptions are persisted team data, not localization keys. */
export function agentDisplayName(profile: AgentProfile, _t: TFunction<"agent-teams">): string {
	return profile.name;
}

export function agentDisplayDescription(profile: AgentProfile, _t: TFunction<"agent-teams">): string {
	return profile.description;
}

export function teamDisplayName(team: TeamDefinition, _t: TFunction<"agent-teams">): string {
	return team.name;
}
