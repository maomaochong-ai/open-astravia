import { randomUUID } from "node:crypto";
import type { TeamSessionDocument, TeamSessionReference, TeamSessionSnapshot } from "@vetta/agent-team";
import {
	parseCreateAgentProfileInput,
	parseCreateTeamInput,
	parseDeleteAgentProfileInput,
	parseDeleteTeamInput,
	parseSendTeamMessageInput,
	parseUpdateAgentProfileInput,
	parseUpdateTeamInput,
	parseUpdateTeamSessionModelSettingsInput,
} from "@vetta/agent-team";
import type { SessionExecutionMode } from "@vetta/runtime-core";
import { ipcMain } from "electron";
import type {
	DesktopTeamConversationDisplay,
	DesktopTeamSessionSnapshot,
	DesktopTeamSessionStreamEvent,
} from "../../preload/api-types/team-conversation-display.js";
import { agentTeamStore } from "../agent-teams/agent-team-store.js";
import { agentTeamSessionService } from "../agent-teams/team-session-service.js";
import { ensureTeamWorkspace } from "../agent-teams/team-workspace.js";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("agent-teams-ipc");

const CHANNELS = {
	LIST: "vetta:agent-teams:list",
	BLUEPRINTS: "vetta:agent-teams:list-blueprints",
	CREATE_AGENT: "vetta:agent-teams:create-agent",
	UPDATE_AGENT: "vetta:agent-teams:update-agent",
	DELETE_AGENT: "vetta:agent-teams:delete-agent",
	PREVIEW_AGENT: "vetta:agent-teams:preview-agent-update",
	PREVIEW_AGENT_DELETE: "vetta:agent-teams:preview-agent-delete",
	CREATE_TEAM: "vetta:agent-teams:create-team",
	UPDATE_TEAM: "vetta:agent-teams:update-team",
	DELETE_TEAM: "vetta:agent-teams:delete-team",
	CREATE_SESSION: "vetta:agent-teams:create-session",
	CREATE_SESSION_RECORD: "vetta:agent-teams:create-session-record",
	LIST_SESSIONS: "vetta:agent-teams:list-sessions",
	UPDATE_MODEL_SETTINGS: "vetta:agent-teams:update-model-settings",
	SET_EXECUTION_MODE: "vetta:agent-teams:set-execution-mode",
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

function teamSessionReference(value: unknown): { readonly id: string; readonly coordinationSessionPath?: string } {
	if (typeof value === "string") return { id: requiredString(value, "sessionId") };
	if (
		typeof value !== "object" ||
		value === null ||
		Object.keys(value).some((key) => key !== "id" && key !== "coordinationSessionPath") ||
		!("id" in value) ||
		!("coordinationSessionPath" in value)
	) {
		throw new Error("Invalid Team session reference");
	}
	const reference = value as TeamSessionReference;
	return {
		id: requiredString(reference.id, "sessionId"),
		coordinationSessionPath: requiredString(reference.coordinationSessionPath, "coordinationSessionPath"),
	};
}

export interface AgentTeamsIpcDependencies {
	readonly store: Pick<
		typeof agentTeamStore,
		| "read"
		| "listBlueprints"
		| "createAgent"
		| "updateAgent"
		| "deleteAgent"
		| "previewAgentUpdate"
		| "previewAgentDelete"
		| "createTeam"
		| "updateTeam"
		| "deleteTeam"
	>;
	readonly sessions: Pick<
		typeof agentTeamSessionService,
		| "create"
		| "listSessions"
		| "updateModelSettings"
		| "setExecutionMode"
		| "readSnapshot"
		| "send"
		| "snapshot"
		| "subscribe"
		| "abort"
	> &
		Partial<Pick<typeof agentTeamSessionService, "displayProjection" | "createRecord">>;
}

type TeamDisplayProjection = (
	session: TeamSessionDocument,
) => DesktopTeamConversationDisplay | Promise<DesktopTeamConversationDisplay>;

async function withDisplayProjection(
	snapshot: TeamSessionSnapshot,
	displayProjection?: TeamDisplayProjection,
): Promise<DesktopTeamSessionSnapshot> {
	return {
		...snapshot,
		display: displayProjection ? await displayProjection(snapshot.session) : { memberConversations: [] },
	};
}

async function enrichTeamEvent(
	event: Parameters<AgentTeamsIpcDependencies["sessions"]["subscribe"]>[1] extends (payload: infer P) => void
		? P
		: never,
	displayProjection?: TeamDisplayProjection,
): Promise<DesktopTeamSessionStreamEvent> {
	if (event.type === "session-snapshot" || event.type === "session-updated") {
		return { ...event, snapshot: await withDisplayProjection(event.snapshot, displayProjection) };
	}
	return event as DesktopTeamSessionStreamEvent;
}

export function registerAgentTeamsIpc(
	dependencies: AgentTeamsIpcDependencies = { store: agentTeamStore, sessions: agentTeamSessionService },
): () => void {
	const { store, sessions } = dependencies;
	// `displayProjection` is invoked later by IPC callbacks. Bind it once here so
	// the service keeps its runtime/repository context when passed as a callback.
	const displayProjection = sessions.displayProjection?.bind(sessions);
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
	ipcMain.handle(CHANNELS.PREVIEW_AGENT_DELETE, (_event, agentProfileId: unknown) =>
		store.previewAgentDelete(requiredString(agentProfileId, "agentProfileId")),
	);
	ipcMain.handle(CHANNELS.CREATE_TEAM, (_event, input: unknown) => store.createTeam(parseCreateTeamInput(input)));
	ipcMain.handle(CHANNELS.UPDATE_TEAM, (_event, teamId: unknown, input: unknown) =>
		store.updateTeam(requiredString(teamId, "teamId"), parseUpdateTeamInput(input)),
	);
	ipcMain.handle(CHANNELS.DELETE_TEAM, (_event, teamId: unknown, input: unknown) =>
		store.deleteTeam(requiredString(teamId, "teamId"), parseDeleteTeamInput(input)),
	);
	ipcMain.handle(CHANNELS.CREATE_SESSION, async (_event, teamId: unknown) => {
		const document = await store.read();
		const parsedTeamId = requiredString(teamId, "teamId");
		const team = document.teams.find((candidate) => candidate.id === parsedTeamId);
		if (!team) throw new Error("Team not found");
		const cwd = await ensureTeamWorkspace(parsedTeamId);
		return await withDisplayProjection(
			sessions.snapshot(await sessions.create(team, document, cwd)),
			displayProjection,
		);
	});
	ipcMain.handle(CHANNELS.CREATE_SESSION_RECORD, async (_event, teamId: unknown) => {
		const document = await store.read();
		const parsedTeamId = requiredString(teamId, "teamId");
		const team = document.teams.find((candidate) => candidate.id === parsedTeamId);
		if (!team) throw new Error("Team not found");
		const cwd = await ensureTeamWorkspace(parsedTeamId);
		return await withDisplayProjection(
			sessions.snapshot(
				await (sessions.createRecord
					? sessions.createRecord(team, document, cwd)
					: sessions.create(team, document, cwd)),
			),
			displayProjection,
		);
	});
	ipcMain.handle(CHANNELS.LIST_SESSIONS, (_event, teamId: unknown) =>
		sessions.listSessions(requiredString(teamId, "teamId")),
	);
	ipcMain.handle(
		CHANNELS.UPDATE_MODEL_SETTINGS,
		async (_event, id: unknown, input: unknown) =>
			await withDisplayProjection(
				sessions.snapshot(
					await sessions.updateModelSettings(
						requiredString(id, "sessionId"),
						parseUpdateTeamSessionModelSettingsInput(input),
					),
				),
				displayProjection,
			),
	);
	ipcMain.handle(CHANNELS.SET_EXECUTION_MODE, async (_event, id: unknown, mode: unknown) => {
		if (mode !== "sandbox" && mode !== "full-access") throw new Error("Invalid executionMode");
		return await withDisplayProjection(
			sessions.snapshot(
				await sessions.setExecutionMode(requiredString(id, "sessionId"), mode as SessionExecutionMode),
			),
			displayProjection,
		);
	});
	ipcMain.handle(CHANNELS.GET_SESSION, async (_event, value: unknown) => {
		const reference = teamSessionReference(value);
		const startedAt = Date.now();
		log.info("team get-session started", {
			teamSessionId: reference.id,
			hasCoordinationSessionPath: Boolean(reference.coordinationSessionPath),
		});
		try {
			const snapshot = await sessions.readSnapshot(reference.id, reference.coordinationSessionPath);
			const projected = await withDisplayProjection(snapshot, displayProjection);
			log.info("team get-session completed", {
				teamSessionId: reference.id,
				elapsedMs: Date.now() - startedAt,
			});
			return projected;
		} catch (error) {
			log.error("team get-session failed", {
				teamSessionId: reference.id,
				elapsedMs: Date.now() - startedAt,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	});
	ipcMain.handle(CHANNELS.SEND_MESSAGE, async (_event, id: unknown, input: unknown) => {
		const sessionId = requiredString(id, "sessionId");
		const startedAt = Date.now();
		let parsed: ReturnType<typeof parseSendTeamMessageInput>;
		try {
			parsed = parseSendTeamMessageInput(input);
		} catch (error) {
			log.error("team send-message input rejected", {
				teamSessionId: sessionId,
				elapsedMs: Date.now() - startedAt,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
		log.info("team send-message entered", {
			teamSessionId: sessionId,
			requestId: parsed.requestId,
			textLength: parsed.text.length,
			targetMemberCount: parsed.targetMemberIds?.length ?? 0,
			attachmentCount: parsed.attachments?.length ?? 0,
			modelKey: parsed.modelKey,
			reasoning: parsed.reasoning,
		});
		try {
			const next = await sessions.send(sessionId, parsed);
			const projected = await withDisplayProjection(sessions.snapshot(next), displayProjection);
			log.info("team send-message completed", {
				teamSessionId: sessionId,
				requestId: parsed.requestId,
				elapsedMs: Date.now() - startedAt,
			});
			return projected;
		} catch (error) {
			log.error("team send-message failed", {
				teamSessionId: sessionId,
				requestId: parsed.requestId,
				elapsedMs: Date.now() - startedAt,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	});
	ipcMain.handle(CHANNELS.ABORT, (_event, id: unknown) => sessions.abort(requiredString(id, "sessionId")));
	ipcMain.handle(CHANNELS.SUBSCRIBE, async (event, id: unknown) => {
		const sessionId = requiredString(id, "sessionId");
		const subscriptionId = `${sessionId}:${randomUUID()}`;
		log.info("team stream subscription started", { teamSessionId: sessionId, subscriptionId });
		let sendQueue = Promise.resolve();
		const subscription = sessions.subscribe(sessionId, (payload) => {
			sendQueue = sendQueue
				.then(async () => {
					if (event.sender.isDestroyed()) return;
					event.sender.send(
						"vetta:agent-teams:stream-event",
						subscriptionId,
						await enrichTeamEvent(payload, displayProjection),
					);
				})
				.catch((error: unknown) => {
					log.error("team stream event delivery failed", {
						teamSessionId: sessionId,
						subscriptionId,
						eventType: payload.type,
						error: error instanceof Error ? error.message : String(error),
					});
				});
		});
		const cleanup = () => {
			event.sender.removeListener("destroyed", cleanup);
			subscription.unsubscribe();
			subscriptions.delete(subscriptionId);
			log.info("team stream subscription cleaned up", { teamSessionId: sessionId, subscriptionId });
		};
		event.sender.once("destroyed", cleanup);
		subscriptions.set(subscriptionId, cleanup);
		const response = {
			subscriptionId,
			...(subscription.snapshot ? { initial: await enrichTeamEvent(subscription.snapshot, displayProjection) } : {}),
		};
		log.info("team stream subscription ready", {
			teamSessionId: sessionId,
			subscriptionId,
			hasInitialSnapshot: Boolean(subscription.snapshot),
		});
		return response;
	});
	ipcMain.handle(CHANNELS.UNSUBSCRIBE, (_event, subscriptionId: unknown) => {
		const key = requiredString(subscriptionId, "subscriptionId");
		subscriptions.get(key)?.();
	});
	return () => {
		for (const unsubscribe of subscriptions.values()) unsubscribe();
		subscriptions.clear();
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
