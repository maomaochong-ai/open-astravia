import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import { subscribeById } from "./helper.js";

const STREAM_EVENT = "vetta:agent-teams:stream-event";

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
			subscribe: (id, handler) =>
				subscribeById(ipc, "vetta:agent-teams:subscribe", STREAM_EVENT, "vetta:agent-teams:unsubscribe", handler, [
					id,
				]),
			abort: (id) => ipc.invoke("vetta:agent-teams:abort", id),
			sendMessage: (id, input) => ipc.invoke("vetta:agent-teams:send-message", id, input),
		},
	};
}
