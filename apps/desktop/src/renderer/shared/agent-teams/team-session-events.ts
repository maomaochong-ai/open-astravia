export const TEAM_SESSIONS_CHANGED_EVENT = "vetta:agent-team-sessions-changed";
export const TEAM_CONFIGURATION_CHANGED_EVENT = "vetta:agent-team-configuration-changed";

export function notifyTeamSessionsChanged(teamId?: string): void {
	window.dispatchEvent(new CustomEvent(TEAM_SESSIONS_CHANGED_EVENT, { detail: { teamId } }));
}

export function notifyAgentTeamConfigurationChanged(): void {
	window.dispatchEvent(new Event(TEAM_CONFIGURATION_CHANGED_EVENT));
}
