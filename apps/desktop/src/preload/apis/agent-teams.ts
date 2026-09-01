import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";

export function createAgentTeamsApi(ipc: IpcRenderer): Pick<DesktopApi, "agentTeams"> {
	return {
		agentTeams: {
			list: () => ipc.invoke("vetta:agent-teams:list"),
			listBlueprints: () => ipc.invoke("vetta:agent-teams:list-blueprints"),
			createAgent: (input) => ipc.invoke("vetta:agent-teams:create-agent", input),
			updateAgent: (id, input) => ipc.invoke("vetta:agent-teams:update-agent", id, input),
			deleteAgent: (id, input) => ipc.invoke("vetta:agent-teams:delete-agent", id, input),
			previewAgentUpdate: (id) => ipc.invoke("vetta:agent-teams:preview-agent-update", id),
			createTeam: (input) => ipc.invoke("vetta:agent-teams:create-team", input),
			createSession: (teamId, cwd) => ipc.invoke("vetta:agent-teams:create-session", teamId, cwd),
			getSession: (id) => ipc.invoke("vetta:agent-teams:get-session", id),
			sendMessage: (id, input) => ipc.invoke("vetta:agent-teams:send-message", id, input),
		},
	};
}
