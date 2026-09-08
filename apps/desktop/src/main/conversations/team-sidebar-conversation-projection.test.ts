import { createAgentTeamFixture } from "@vetta/agent-team";
import { describe, expect, it, vi } from "vitest";
import { listTeamSidebarConversations } from "./team-sidebar-conversation-projection.js";

vi.mock("../agent-teams/agent-team-store.js", () => ({ agentTeamStore: {} }));
vi.mock("../agent-teams/team-session-service.js", () => ({ agentTeamSessionService: {} }));
vi.mock("../config/desktop-config-store.js", () => ({ readDesktopConfig: vi.fn() }));

describe("listTeamSidebarConversations", () => {
	it("projects Team sessions by semantic placement and keeps the Team identity", async () => {
		const document = createAgentTeamFixture();
		const team = document.teams[0];
		if (!team) throw new Error("missing Team fixture");
		const result = await listTeamSidebarConversations({
			readDocument: async () => document,
			listProjectPaths: async () => ["C:/Projects/Vetta"],
			listSessions: async () => [
				{
					id: "project-session",
					coordinationSessionPath: "C:/sessions/project.jsonl",
					title: "Project work",
					createdAt: 1,
					updatedAt: 3,
					workspaceKind: "project",
					workspaceId: "c:/projects/vetta/",
					cwd: "c:/projects/vetta/",
				},
				{
					id: "session-workspace",
					coordinationSessionPath: "C:/sessions/isolated.jsonl",
					title: "Isolated work",
					createdAt: 1,
					updatedAt: 2,
					workspaceKind: "session",
					workspaceId: `agent-team:${team.id}:session:workspace-a`,
					cwd: "C:/session-workspaces/workspace-a",
				},
				{
					id: "legacy-default-session",
					coordinationSessionPath: "C:/sessions/legacy-default.jsonl",
					title: "Legacy default work",
					createdAt: 1,
					updatedAt: 1,
					workspaceKind: "team-default",
					workspaceId: `agent-team:${team.id}`,
					cwd: "C:/team-default",
				},
			],
		});

		expect(result).toEqual([
			expect.objectContaining({
				teamId: team.id,
				teamName: team.name,
				teamSessionId: "project-session",
				placement: { kind: "project", projectPath: "C:/Projects/Vetta" },
				memberAvatarUrls: expect.any(Array),
			}),
			expect.objectContaining({
				teamSessionId: "session-workspace",
				placement: { kind: "default" },
			}),
			expect.objectContaining({
				teamSessionId: "legacy-default-session",
				placement: { kind: "default" },
			}),
		]);
	});

	it("falls back to the default conversation list when a selected project is no longer registered", async () => {
		const document = createAgentTeamFixture();
		const team = document.teams[0];
		if (!team) throw new Error("missing Team fixture");
		const [result] = await listTeamSidebarConversations({
			readDocument: async () => document,
			listProjectPaths: async () => [],
			listSessions: async () => [
				{
					id: "removed-project",
					coordinationSessionPath: "C:/sessions/removed.jsonl",
					title: "Still visible",
					createdAt: 1,
					updatedAt: 2,
					workspaceKind: "project",
					cwd: "C:/Projects/Removed",
				},
			],
		});

		expect(result?.placement).toEqual({ kind: "default" });
	});
});
