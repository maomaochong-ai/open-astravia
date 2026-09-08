import type { SessionInfo } from "@shared/store/atoms";
import type { DesktopTeamSidebarConversation } from "../../../../shared/sidebar-conversation";

export type SidebarConversationInfo =
	| ({ readonly kind: "conversation" } & SessionInfo)
	| {
			readonly kind: "agent-team";
			readonly id: string;
			readonly path: string;
			readonly cwd: string;
			readonly firstMessage: string;
			readonly modifiedAt: number;
			readonly teamId: string;
			readonly teamSessionId: string;
			readonly memberAvatarUrls: readonly string[];
			readonly sessionTitle: string;
	  };

export type SidebarConversationPlacement =
	| { readonly kind: "default" }
	| { readonly kind: "project"; readonly projectPath: string };

export interface SidebarConversationIdentity {
	readonly key: string;
	readonly label: string;
	readonly iconClassName?: string;
	readonly trailingAvatarUrls?: readonly string[];
	readonly mutable: boolean;
	readonly titleExtra?: string;
}

export interface SidebarConversationIdentityLabels {
	readonly conversationLabel?: string;
	readonly untitledTeamLabel: string;
}

export function projectSidebarConversations(
	ordinarySessions: readonly SessionInfo[],
	teamSessions: readonly DesktopTeamSidebarConversation[],
	placement: SidebarConversationPlacement,
): SidebarConversationInfo[] {
	const projectedTeams = teamSessions.filter((session) => samePlacement(session.placement, placement));
	const teamPaths = new Set(projectedTeams.map((session) => normalizedPath(session.coordinationSessionPath)));
	return [
		...ordinarySessions
			.filter((session) => !teamPaths.has(normalizedPath(session.path)))
			.map((session): SidebarConversationInfo => ({ ...session, kind: "conversation" })),
		...projectedTeams.map(
			(session): SidebarConversationInfo => ({
				kind: "agent-team",
				id: session.teamSessionId,
				path: session.coordinationSessionPath,
				cwd: session.placement.kind === "project" ? session.placement.projectPath : "",
				firstMessage: session.sessionTitle,
				modifiedAt: session.updatedAt,
				teamId: session.teamId,
				teamSessionId: session.teamSessionId,
				memberAvatarUrls: session.memberAvatarUrls,
				sessionTitle: session.sessionTitle,
			}),
		),
	].sort((left, right) => right.modifiedAt - left.modifiedAt);
}

export function sidebarConversationKey(session: SidebarConversationInfo): string {
	return session.kind === "agent-team" ? `agent-team:${session.teamSessionId}` : `conversation:${session.path}`;
}

/** Keeps source-specific identity rules out of the list components. */
export function sidebarConversationIdentity(
	session: SidebarConversationInfo,
	labels: SidebarConversationIdentityLabels,
): SidebarConversationIdentity {
	if (session.kind === "conversation") {
		return {
			key: sidebarConversationKey(session),
			label: labels.conversationLabel ?? session.firstMessage,
			mutable: true,
		};
	}
	return {
		key: sidebarConversationKey(session),
		label: session.sessionTitle || labels.untitledTeamLabel,
		iconClassName: "icon-[solar--users-group-rounded-linear]",
		trailingAvatarUrls: session.memberAvatarUrls,
		mutable: false,
	};
}

export function isSidebarConversationActive(
	session: SidebarConversationInfo,
	activeSessionPath: string,
	activeTeamSessionId: string,
): boolean {
	if (activeTeamSessionId) {
		return session.kind === "agent-team" && activeTeamSessionId === session.teamSessionId;
	}
	return session.kind === "conversation" && activeSessionPath === session.path;
}

function samePlacement(
	left: DesktopTeamSidebarConversation["placement"],
	right: SidebarConversationPlacement,
): boolean {
	if (left.kind !== right.kind) return false;
	if (left.kind === "default" || right.kind === "default") return true;
	return normalizedPath(left.projectPath) === normalizedPath(right.projectPath);
}

function normalizedPath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase("en-US");
}
