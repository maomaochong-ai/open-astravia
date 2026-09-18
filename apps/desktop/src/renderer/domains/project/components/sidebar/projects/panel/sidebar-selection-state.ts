export type SidebarSelectionTarget = { kind: "conversation"; path: string } | { kind: "agent-team"; sessionId: string };

interface SidebarSelectionSources {
	currentPath: string;
	activeSessionPath: string;
	pendingSessionPath: string;
	viewerSessionPath: string;
	routeTeamSessionId: string;
}

/** The rendered page owns the final highlight; pending opens are only provisional. */
export function resolveSidebarSelectionState(sources: SidebarSelectionSources): {
	fallbackSelection: SidebarSelectionTarget | null;
	settledSelection: SidebarSelectionTarget | null;
} {
	if (sources.currentPath.startsWith("/agent-teams/")) {
		const selection: SidebarSelectionTarget | null = sources.routeTeamSessionId
			? { kind: "agent-team", sessionId: sources.routeTeamSessionId }
			: null;
		return { fallbackSelection: selection, settledSelection: selection };
	}
	if (sources.pendingSessionPath) {
		return {
			fallbackSelection: { kind: "conversation", path: sources.pendingSessionPath },
			settledSelection: null,
		};
	}
	if (sources.viewerSessionPath) {
		const selection: SidebarSelectionTarget = { kind: "conversation", path: sources.viewerSessionPath };
		return { fallbackSelection: selection, settledSelection: selection };
	}
	if (sources.activeSessionPath) {
		const selection: SidebarSelectionTarget = { kind: "conversation", path: sources.activeSessionPath };
		return { fallbackSelection: selection, settledSelection: sources.currentPath === "/" ? selection : null };
	}
	return { fallbackSelection: null, settledSelection: null };
}
