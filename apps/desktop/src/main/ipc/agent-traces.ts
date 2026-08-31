import { ipcMain } from "electron";
import { AGENT_TRACES_QUERY_CHANNEL } from "../../shared/agent-traces.js";
import { getAgentTraceRepository } from "../agent-observability/composition.js";

export function registerAgentTracesIpc(): () => void {
	ipcMain.handle(AGENT_TRACES_QUERY_CHANNEL, (_event, request: unknown) => getAgentTraceRepository().query(request));
	return () => ipcMain.removeHandler(AGENT_TRACES_QUERY_CHANNEL);
}
