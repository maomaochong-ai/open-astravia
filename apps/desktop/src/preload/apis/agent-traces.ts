import type { IpcRenderer } from "electron";
import { AGENT_TRACES_QUERY_CHANNEL, type DesktopAgentTracesApi } from "../../shared/agent-traces.js";

export function createAgentTracesApi(ipc: Pick<IpcRenderer, "invoke">): { agentTraces: DesktopAgentTracesApi } {
	return { agentTraces: { query: (request) => ipc.invoke(AGENT_TRACES_QUERY_CHANNEL, request) } };
}
