import { type AgentProfile, DEFAULT_AGENT_TEAM_ID, isBuiltinAgentPreset, type TeamDefinition } from "@vetta/agent-team";
import type { TFunction } from "i18next";

export function presetAgentNameKey(profile: AgentProfile): string | undefined {
	return isBuiltinAgentPreset(profile) && profile.presetId ? `presets.agents.${profile.presetId}.name` : undefined;
}

export function presetAgentDescriptionKey(profile: AgentProfile): string | undefined {
	return isBuiltinAgentPreset(profile) && profile.presetId
		? `presets.agents.${profile.presetId}.description`
		: undefined;
}

export function presetTeamNameKey(team: TeamDefinition): string | undefined {
	return team.id === DEFAULT_AGENT_TEAM_ID ? "presets.defaultTeam.name" : undefined;
}

export function agentDisplayName(profile: AgentProfile, t: TFunction<"agent-teams">): string {
	const key = presetAgentNameKey(profile);
	return key ? t(key as never) : profile.name;
}

export function agentDisplayDescription(profile: AgentProfile, t: TFunction<"agent-teams">): string {
	const key = presetAgentDescriptionKey(profile);
	return key ? t(key as never) : profile.description;
}

export function teamDisplayName(team: TeamDefinition, t: TFunction<"agent-teams">): string {
	const key = presetTeamNameKey(team);
	return key ? t(key as never) : team.name;
}
