import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import { subscribeById } from "./helper.js";

const STREAM_EVENT = "vetta:agent-teams:stream-event";
const CHANGED_EVENT = "vetta:agent-teams:changed";
const MEMBER_MODELS_CHANGED_EVENT = "vetta:agent-teams:member-models-changed";

export function createAgentTeamsApi(ipc: IpcRenderer): Pick<DesktopApi, "agentTeams"> {
	return {
		agentTeams: {
			list: () => ipc.invoke("vetta:agent-teams:list"),
			onChanged: (listener) => {
				const handler = (): void => listener();
				ipc.on(CHANGED_EVENT, handler);
				return () => {
					ipc.removeListener(CHANGED_EVENT, handler);
				};
			},
			onMemberModelsChanged: (listener) => {
				const handler = (_event: unknown, teamId: unknown): void => {
					if (typeof teamId === "string") listener(teamId);
				};
				ipc.on(MEMBER_MODELS_CHANGED_EVENT, handler);
				return () => {
					ipc.removeListener(MEMBER_MODELS_CHANGED_EVENT, handler);
				};
			},
			listBlueprints: () => ipc.invoke("vetta:agent-teams:list-blueprints"),
			createAgent: (input) => ipc.invoke("vetta:agent-teams:create-agent", input),
			updateAgent: (id, input) => ipc.invoke("vetta:agent-teams:update-agent", id, input),
			deleteAgent: (id, input) => ipc.invoke("vetta:agent-teams:delete-agent", id, input),
			previewAgentUpdate: (id) => ipc.invoke("vetta:agent-teams:preview-agent-update", id),
			previewAgentDelete: (id) => ipc.invoke("vetta:agent-teams:preview-agent-delete", id),
			createTeam: (input) => ipc.invoke("vetta:agent-teams:create-team", input),
			updateTeam: (id, input) => ipc.invoke("vetta:agent-teams:update-team", id, input),
			deleteTeam: (id, input) => ipc.invoke("vetta:agent-teams:delete-team", id, input),
			createSession: (teamId) => ipc.invoke("vetta:agent-teams:create-session", teamId),
			createSessionRecord: (teamId, options) =>
				options
					? ipc.invoke("vetta:agent-teams:create-session-record", teamId, options)
					: ipc.invoke("vetta:agent-teams:create-session-record", teamId),
			listSessions: (teamId) => ipc.invoke("vetta:agent-teams:list-sessions", teamId),
			listSidebarConversations: () => ipc.invoke("vetta:agent-teams:list-sidebar-conversations"),
			renameSession: (reference, name) => ipc.invoke("vetta:agent-teams:rename-session", reference, name),
			deleteSession: (reference) => ipc.invoke("vetta:agent-teams:delete-session", reference),
			updateModelSettings: (id, input) => ipc.invoke("vetta:agent-teams:update-model-settings", id, input),
			listMemberModels: (teamId) => ipc.invoke("vetta:agent-teams:list-member-models", teamId),
			setMemberModel: (teamId, memberId, selection) =>
				ipc.invoke("vetta:agent-teams:set-member-model", teamId, memberId, selection),
			setExecutionMode: (id, mode) => ipc.invoke("vetta:agent-teams:set-execution-mode", id, mode),
			getSession: (id) => ipc.invoke("vetta:agent-teams:get-session", id),
			subscribe: (id, handler) =>
				subscribeById(ipc, "vetta:agent-teams:subscribe", STREAM_EVENT, "vetta:agent-teams:unsubscribe", handler, [
					id,
				]),
			abort: (id) => ipc.invoke("vetta:agent-teams:abort", id),
			uploadAvatar: () => ipc.invoke("vetta:agent-teams:upload-avatar"),
			sendMessage: (id, input) => ipc.invoke("vetta:agent-teams:send-message", id, input),
		},
	};
}
