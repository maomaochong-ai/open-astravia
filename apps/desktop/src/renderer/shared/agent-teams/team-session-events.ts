export const TEAM_SESSIONS_CHANGED_EVENT = "vetta:agent-team-sessions-changed";

export function notifyTeamSessionsChanged(): void {
	window.dispatchEvent(new Event(TEAM_SESSIONS_CHANGED_EVENT));
}
