export const TEAM_SESSIONS_CHANGED_EVENT = "vetta:agent-team-sessions-changed";

export function notifyTeamSessionsChanged(teamId?: string): void {
	window.dispatchEvent(new CustomEvent(TEAM_SESSIONS_CHANGED_EVENT, { detail: { teamId } }));
}
