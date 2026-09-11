export type DesktopSidebarPlacement =
	| { readonly kind: "default" }
	| { readonly kind: "project"; readonly projectPath: string };

/** Product-level Team conversation projection consumed by the sidebar. */
export interface DesktopTeamSidebarConversation {
	readonly kind: "agent-team";
	readonly teamId: string;
	readonly teamSessionId: string;
	readonly coordinationSessionPath: string;
	/** Workspace shown by sidebar actions such as "Open in folder". */
	readonly cwd: string;
	readonly memberAvatarUrls: readonly string[];
	readonly sessionTitle: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly placement: DesktopSidebarPlacement;
}
