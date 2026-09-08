import { TEAM_CONFIGURATION_CHANGED_EVENT, TEAM_SESSIONS_CHANGED_EVENT } from "@shared/agent-teams/team-session-events";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopTeamSidebarConversation } from "../../../../shared/sidebar-conversation";

export function useTeamSidebarConversations(projectPaths: readonly string[]): {
	readonly conversations: readonly DesktopTeamSidebarConversation[];
	readonly loading: boolean;
} {
	const [conversations, setConversations] = useState<readonly DesktopTeamSidebarConversation[]>([]);
	const [loading, setLoading] = useState(true);
	const requestRevisionRef = useRef(0);
	const projectPathsKey = [...projectPaths].sort().join("\u0000");

	const load = useCallback(() => {
		void projectPathsKey;
		const requestRevision = ++requestRevisionRef.current;
		setLoading(true);
		void window.vetta.agentTeams
			.listSidebarConversations()
			.then((next) => {
				if (requestRevisionRef.current === requestRevision) setConversations(next);
			})
			.catch(() => undefined)
			.finally(() => {
				if (requestRevisionRef.current === requestRevision) setLoading(false);
			});
	}, [projectPathsKey]);

	useEffect(() => {
		load();
		window.addEventListener(TEAM_SESSIONS_CHANGED_EVENT, load);
		window.addEventListener(TEAM_CONFIGURATION_CHANGED_EVENT, load);
		return () => {
			requestRevisionRef.current += 1;
			window.removeEventListener(TEAM_SESSIONS_CHANGED_EVENT, load);
			window.removeEventListener(TEAM_CONFIGURATION_CHANGED_EVENT, load);
		};
	}, [load]);

	return { conversations, loading };
}
