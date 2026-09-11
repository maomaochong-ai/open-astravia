import { dirname } from "node:path";
import type { AgentTeamDocument, TeamSessionListItem } from "@vetta/agent-team";
import { teamMemberAvatarUrls } from "../../shared/agent-team-avatar.js";
import type { DesktopTeamSidebarConversation } from "../../shared/sidebar-conversation.js";
import { agentBlueprintRegistry } from "../agent-teams/agent-blueprint-registry.js";
import { agentTeamStore } from "../agent-teams/agent-team-store.js";
import { agentTeamSessionService } from "../agent-teams/team-session-service.js";
import { readDesktopConfig } from "../config/desktop-config-store.js";
import { sameProjectPath } from "../projects/project-path.js";

export interface TeamSidebarConversationProjectionDependencies {
	readonly readDocument: () => Promise<AgentTeamDocument>;
	readonly listSessions: (teamId: string) => Promise<readonly TeamSessionListItem[]>;
	readonly listProjectPaths: () => Promise<readonly string[]>;
}

const defaultDependencies: TeamSidebarConversationProjectionDependencies = {
	readDocument: () => agentTeamStore.read(),
	listSessions: (teamId) => agentTeamSessionService.listSessions(teamId),
	listProjectPaths: async () => (await readDesktopConfig()).projects.map((project) => project.path),
};

/**
 * Converts Team storage ownership into the user's sidebar model. The renderer never
 * needs to interpret Team cwd conventions or workspace id prefixes.
 */
export async function listTeamSidebarConversations(
	dependencies: TeamSidebarConversationProjectionDependencies = defaultDependencies,
): Promise<readonly DesktopTeamSidebarConversation[]> {
	const [document, projectPaths] = await Promise.all([dependencies.readDocument(), dependencies.listProjectPaths()]);
	const agentsById = new Map(document.agents.map((agent) => [agent.id, agent]));
	const blueprintsById = new Map(agentBlueprintRegistry.list().map((blueprint) => [blueprint.id, blueprint]));
	const projected = (
		await Promise.all(
			document.teams.map(async (team) => {
				// 头像随人设走，人设由提供方维护：blueprint 解析得到才画得出提供方那张图。
				const avatarUrls = teamMemberAvatarUrls(team, agentsById, blueprintsById);
				return (await dependencies.listSessions(team.id)).map((session) => ({
					kind: "agent-team" as const,
					teamId: team.id,
					teamSessionId: session.id,
					coordinationSessionPath: session.coordinationSessionPath,
					cwd: session.cwd ?? dirname(session.coordinationSessionPath),
					memberAvatarUrls: avatarUrls,
					sessionTitle: session.title,
					createdAt: session.createdAt,
					updatedAt: session.updatedAt,
					placement: resolvePlacement(session, projectPaths),
				}));
			}),
		)
	).flat();

	const unique = new Map<string, DesktopTeamSidebarConversation>();
	for (const item of projected) {
		const current = unique.get(item.teamSessionId);
		if (!current || item.updatedAt > current.updatedAt) unique.set(item.teamSessionId, item);
	}
	return [...unique.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

function resolvePlacement(
	session: TeamSessionListItem,
	projectPaths: readonly string[],
): DesktopTeamSidebarConversation["placement"] {
	const workspaceKind =
		session.workspaceKind ??
		(session.workspaceId && !session.workspaceId.startsWith("agent-team:") ? "project" : "team-default");
	if (workspaceKind !== "project" || !session.cwd) return { kind: "default" };
	const sessionCwd = session.cwd;
	const projectPath = projectPaths.find((path) => sameProjectPath(path, sessionCwd));
	return projectPath ? { kind: "project", projectPath } : { kind: "default" };
}
