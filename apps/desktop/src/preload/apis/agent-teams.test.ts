import type { IpcRenderer } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createAgentTeamsApi } from "./agent-teams.js";

describe("createAgentTeamsApi", () => {
	it("subscribes to scoped model changes and removes the listener on disposal", () => {
		const on = vi.fn();
		const removeListener = vi.fn();
		const api = createAgentTeamsApi({ on, removeListener } as unknown as IpcRenderer).agentTeams;
		const listener = vi.fn();
		const dispose = api.onMemberModelsChanged(listener);
		const [channel, handler] = on.mock.calls[0]!;
		expect(channel).toBe("vetta:agent-teams:member-models-changed");
		handler({}, "team");
		handler({}, { teamId: "invalid" });
		expect(listener.mock.calls).toEqual([["team"]]);
		dispose();
		expect(removeListener).toHaveBeenCalledWith(channel, handler);
	});

	it("forwards team configuration and session operations to their dedicated channels", async () => {
		const invoke = vi.fn(async () => undefined);
		const api = createAgentTeamsApi({ invoke } as unknown as IpcRenderer).agentTeams;
		const agent = {
			name: "Builder",
			mentionHandle: "builder",
			blueprintId: "builder",
			abilities: { skills: [], mcpServers: [], plugins: [] },
		};
		const message = { requestId: "request", text: "Build it", targetMemberIds: ["member"] };

		await api.createAgent(agent);
		await api.deleteAgent("agent", { expectedRevision: 1 });
		await api.previewAgentDelete("agent");
		await api.updateTeam("team", {
			expectedRevision: 1,
			name: "Team",
			description: "",
			members: [{ kind: "existing", memberId: "member", leader: true }],
		});
		await api.deleteTeam("team", { expectedRevision: 1 });
		await api.createSession("team");
		await api.createSessionRecord("team", {
			sessionId: "11111111-1111-4111-8111-111111111111",
			executionMode: "sandbox",
			workspace: { kind: "project", path: "C:/projects/selected" },
		});
		await api.listSessions("team");
		await api.listSidebarConversations();
		await api.renameSession({ id: "session", coordinationSessionPath: "C:/sessions/team.jsonl" }, "Renamed");
		await api.deleteSession({ id: "session", coordinationSessionPath: "C:/sessions/team.jsonl" });
		await api.updateModelSettings("session", { modelKey: "openai/gpt-5", reasoning: "high" });
		await api.listMemberModels("team");
		await api.setMemberModel("team", "member", { modelKey: "openai/gpt-5" });
		await api.setMemberModel("team", "member", null);
		await api.sendMessage("session", message);

		expect(invoke).toHaveBeenNthCalledWith(1, "vetta:agent-teams:create-agent", agent);
		expect(invoke).toHaveBeenNthCalledWith(2, "vetta:agent-teams:delete-agent", "agent", {
			expectedRevision: 1,
		});
		expect(invoke).toHaveBeenNthCalledWith(3, "vetta:agent-teams:preview-agent-delete", "agent");
		expect(invoke).toHaveBeenNthCalledWith(
			4,
			"vetta:agent-teams:update-team",
			"team",
			expect.objectContaining({ expectedRevision: 1 }),
		);
		expect(invoke).toHaveBeenNthCalledWith(5, "vetta:agent-teams:delete-team", "team", {
			expectedRevision: 1,
		});
		expect(invoke).toHaveBeenNthCalledWith(6, "vetta:agent-teams:create-session", "team");
		expect(invoke).toHaveBeenNthCalledWith(7, "vetta:agent-teams:create-session-record", "team", {
			sessionId: "11111111-1111-4111-8111-111111111111",
			executionMode: "sandbox",
			workspace: { kind: "project", path: "C:/projects/selected" },
		});
		expect(invoke).toHaveBeenNthCalledWith(8, "vetta:agent-teams:list-sessions", "team");
		expect(invoke).toHaveBeenNthCalledWith(9, "vetta:agent-teams:list-sidebar-conversations");
		expect(invoke).toHaveBeenNthCalledWith(
			10,
			"vetta:agent-teams:rename-session",
			{
				id: "session",
				coordinationSessionPath: "C:/sessions/team.jsonl",
			},
			"Renamed",
		);
		expect(invoke).toHaveBeenNthCalledWith(11, "vetta:agent-teams:delete-session", {
			id: "session",
			coordinationSessionPath: "C:/sessions/team.jsonl",
		});
		expect(invoke).toHaveBeenNthCalledWith(12, "vetta:agent-teams:update-model-settings", "session", {
			modelKey: "openai/gpt-5",
			reasoning: "high",
		});
		expect(invoke).toHaveBeenNthCalledWith(13, "vetta:agent-teams:list-member-models", "team");
		expect(invoke).toHaveBeenNthCalledWith(14, "vetta:agent-teams:set-member-model", "team", "member", {
			modelKey: "openai/gpt-5",
		});
		expect(invoke).toHaveBeenNthCalledWith(15, "vetta:agent-teams:set-member-model", "team", "member", null);
		expect(invoke).toHaveBeenNthCalledWith(16, "vetta:agent-teams:send-message", "session", message);
	});
});
