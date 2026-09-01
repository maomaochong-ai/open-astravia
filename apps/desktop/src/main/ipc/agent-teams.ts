import { randomUUID } from "node:crypto";
import {
	parseCreateAgentProfileInput,
	parseCreateTeamInput,
	parseDeleteAgentProfileInput,
	parseSendTeamMessageInput,
	parseUpdateAgentProfileInput,
} from "@vetta/agent-team";
import { ipcMain } from "electron";
import { agentTeamStore } from "../agent-teams/agent-team-store.js";
import { agentTeamSessionService } from "../agent-teams/team-session-service.js";

const CHANNELS = {
	LIST: "vetta:agent-teams:list",
	BLUEPRINTS: "vetta:agent-teams:list-blueprints",
	CREATE_AGENT: "vetta:agent-teams:create-agent",
	UPDATE_AGENT: "vetta:agent-teams:update-agent",
	DELETE_AGENT: "vetta:agent-teams:delete-agent",
	PREVIEW_AGENT: "vetta:agent-teams:preview-agent-update",
	CREATE_TEAM: "vetta:agent-teams:create-team",
	CREATE_SESSION: "vetta:agent-teams:create-session",
	GET_SESSION: "vetta:agent-teams:get-session",
	SEND_MESSAGE: "vetta:agent-teams:send-message",
	SUBSCRIBE: "vetta:agent-teams:subscribe",
	UNSUBSCRIBE: "vetta:agent-teams:unsubscribe",
	ABORT: "vetta:agent-teams:abort",
} as const;

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
	return value;
}

export interface AgentTeamsIpcDependencies {
	readonly store: Pick<
		typeof agentTeamStore,
		"read" | "listBlueprints" | "createAgent" | "updateAgent" | "deleteAgent" | "previewAgentUpdate" | "createTeam"
	>;
	readonly sessions: Pick<typeof agentTeamSessionService, "create" | "read" | "send" | "subscribe" | "abort">;
}

export function registerAgentTeamsIpc(
	dependencies: AgentTeamsIpcDependencies = { store: agentTeamStore, sessions: agentTeamSessionService },
): () => void {
	const { store, sessions } = dependencies;
	const subscriptions = new Map<string, () => void>();
	ipcMain.handle(CHANNELS.LIST, () => store.read());
	ipcMain.handle(CHANNELS.BLUEPRINTS, () => store.listBlueprints());
	ipcMain.handle(CHANNELS.CREATE_AGENT, (_event, input: unknown) =>
		store.createAgent(parseCreateAgentProfileInput(input)),
	);
	ipcMain.handle(CHANNELS.UPDATE_AGENT, (_event, agentProfileId: unknown, input: unknown) =>
		store.updateAgent(requiredString(agentProfileId, "agentProfileId"), parseUpdateAgentProfileInput(input)),
	);
	ipcMain.handle(CHANNELS.DELETE_AGENT, (_event, agentProfileId: unknown, input: unknown) =>
		store.deleteAgent(requiredString(agentProfileId, "agentProfileId"), parseDeleteAgentProfileInput(input)),
	);
	ipcMain.handle(CHANNELS.PREVIEW_AGENT, (_event, agentProfileId: unknown) =>
		store.previewAgentUpdate(requiredString(agentProfileId, "agentProfileId")),
	);
	ipcMain.handle(CHANNELS.CREATE_TEAM, (_event, input: unknown) => store.createTeam(parseCreateTeamInput(input)));
	ipcMain.handle(CHANNELS.CREATE_SESSION, async (_event, teamId: unknown, cwd: unknown) => {
		const document = await store.read();
		const team = document.teams.find((candidate) => candidate.id === requiredString(teamId, "teamId"));
		if (!team) throw new Error("Team not found");
		return sessions.create(team, document, requiredString(cwd, "cwd"));
	});
	ipcMain.handle(CHANNELS.GET_SESSION, (_event, id: unknown) => sessions.read(requiredString(id, "sessionId")));
	ipcMain.handle(CHANNELS.SEND_MESSAGE, (_event, id: unknown, input: unknown) =>
		sessions.send(requiredString(id, "sessionId"), parseSendTeamMessageInput(input)),
	);
	ipcMain.handle(CHANNELS.ABORT, (_event, id: unknown) => sessions.abort(requiredString(id, "sessionId")));
	ipcMain.handle(CHANNELS.SUBSCRIBE, async (event, id: unknown) => {
		const sessionId = requiredString(id, "sessionId");
		const subscriptionId = `${sessionId}:${randomUUID()}`;
		const unsubscribe = sessions.subscribe(sessionId, (payload) => {
			if (!event.sender.isDestroyed()) {
				event.sender.send("vetta:agent-teams:stream-event", subscriptionId, payload);
			}
		});
		subscriptions.set(subscriptionId, unsubscribe);
		return { subscriptionId };
	});
	ipcMain.handle(CHANNELS.UNSUBSCRIBE, (_event, subscriptionId: unknown) => {
		const key = requiredString(subscriptionId, "subscriptionId");
		subscriptions.get(key)?.();
		subscriptions.delete(key);
	});
	return () => {
		for (const unsubscribe of subscriptions.values()) unsubscribe();
		subscriptions.clear();
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
