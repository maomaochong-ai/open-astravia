import type { IpcRenderer } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createAgentTeamsApi } from "./agent-teams.js";

describe("createAgentTeamsApi", () => {
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
		await api.createSession("team", "C:/workspace");
		await api.sendMessage("session", message);

		expect(invoke).toHaveBeenNthCalledWith(1, "vetta:agent-teams:create-agent", agent);
		expect(invoke).toHaveBeenNthCalledWith(2, "vetta:agent-teams:delete-agent", "agent", {
			expectedRevision: 1,
		});
		expect(invoke).toHaveBeenNthCalledWith(3, "vetta:agent-teams:create-session", "team", "C:/workspace");
		expect(invoke).toHaveBeenNthCalledWith(4, "vetta:agent-teams:send-message", "session", message);
	});
});
