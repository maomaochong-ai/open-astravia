import { createAgentTeamFixture, createEmptyAgentTeamDocument } from "@vetta/agent-team";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentTeamsIpcDependencies, registerAgentTeamsIpc } from "./agent-teams.js";

const ipc = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	removed: [] as string[],
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler),
		removeHandler: (channel: string) => ipc.removed.push(channel),
	},
}));

vi.mock("../agent-teams/agent-team-store.js", () => ({ agentTeamStore: {} }));
vi.mock("../agent-teams/team-session-service.js", () => ({ agentTeamSessionService: {} }));
vi.mock("../agent-teams/team-workspace.js", () => ({
	ensureTeamWorkspace: vi.fn(async (teamId: string) => `C:/teams/${teamId}/workspace`),
}));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function dependencies(): AgentTeamsIpcDependencies {
	return {
		store: {
			read: vi.fn(async () => createEmptyAgentTeamDocument()),
			listBlueprints: vi.fn(async () => []),
			createAgent: vi.fn(async (input) => ({ ...input, id: "agent" })),
			updateAgent: vi.fn(),
			deleteAgent: vi.fn(),
			previewAgentUpdate: vi.fn(),
			previewAgentDelete: vi.fn(),
			createTeam: vi.fn(),
			updateTeam: vi.fn(),
			deleteTeam: vi.fn(),
		},
		sessions: {
			create: vi.fn(),
			listSessions: vi.fn(async () => []),
			readSnapshot: vi.fn(),
			send: vi.fn(),
			updateModelSettings: vi.fn(),
			setExecutionMode: vi.fn(),
			snapshot: vi.fn((session) => ({ session, conversationRevision: 0, messages: [], activities: [] })),
			subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
			abort: vi.fn(),
		},
	};
}

describe("Agent Team IPC contract", () => {
	beforeEach(() => {
		ipc.handlers.clear();
		ipc.removed.length = 0;
	});

	it("validates renderer input before invoking the domain service", async () => {
		const deps = dependencies();
		registerAgentTeamsIpc(deps);
		const createAgent = ipc.handlers.get("vetta:agent-teams:create-agent");
		if (!createAgent) throw new Error("create-agent handler was not registered");

		expect(() => createAgent({}, { name: "Missing required fields" })).toThrow("Invalid create agent profile input");
		expect(deps.store.createAgent).not.toHaveBeenCalled();

		await createAgent(
			{},
			{
				name: "Builder",
				mentionHandle: "builder",
				blueprintId: "builder",
				abilities: { skills: [], mcpServers: [], plugins: [] },
			},
		);
		expect(deps.store.createAgent).toHaveBeenCalledOnce();
	});

	it("rejects unknown message fields and removes every registered handler", async () => {
		const deps = dependencies();
		const teardown = registerAgentTeamsIpc(deps);
		const sendMessage = ipc.handlers.get("vetta:agent-teams:send-message");
		if (!sendMessage) throw new Error("send-message handler was not registered");

		await expect(
			sendMessage({}, "session", { requestId: "request", text: "Hello", targetMemberIds: [], privateTrace: true }),
		).rejects.toThrow("Invalid send team message input");
		expect(deps.sessions.send).not.toHaveBeenCalled();

		teardown();
		expect(ipc.removed).toHaveLength(ipc.handlers.size);
	});

	it("passes an ordinary Conversation bookmark when reopening a Team session", async () => {
		const deps = dependencies();
		registerAgentTeamsIpc(deps);
		const getSession = ipc.handlers.get("vetta:agent-teams:get-session");
		if (!getSession) throw new Error("get-session handler was not registered");

		await getSession({}, { id: "session", coordinationSessionPath: "C:/runtime/session.jsonl" });
		expect(deps.sessions.readSnapshot).toHaveBeenCalledWith("session", "C:/runtime/session.jsonl");

		await expect(
			getSession({}, { id: "session", coordinationSessionPath: "C:/runtime/session.jsonl", privateState: true }),
		).rejects.toThrow("Invalid Team session reference");
	});

	it("keeps the Team service context when projecting a reopened session", async () => {
		const base = dependencies();
		const displayProjection = vi.fn(async function (this: { getRuntime: () => unknown }) {
			this.getRuntime();
			return { memberConversations: [] };
		});
		const sessionServices = {
			...base.sessions,
			readSnapshot: vi.fn(async () => ({
				session: {} as never,
				conversationRevision: 0,
				messages: [],
				activities: [],
			})),
			getRuntime: vi.fn(),
			displayProjection: displayProjection as AgentTeamsIpcDependencies["sessions"]["displayProjection"],
		};
		const deps: AgentTeamsIpcDependencies = {
			...base,
			sessions: sessionServices as AgentTeamsIpcDependencies["sessions"],
		};
		registerAgentTeamsIpc(deps);
		const getSession = ipc.handlers.get("vetta:agent-teams:get-session");
		if (!getSession) throw new Error("get-session handler was not registered");

		await expect(getSession({}, "session")).resolves.toMatchObject({ display: { memberConversations: [] } });
		expect(displayProjection).toHaveBeenCalledOnce();
	});

	it("returns the bootstrap snapshot without starting the display projection", async () => {
		const base = dependencies();
		const displayProjection = vi.fn(async () => ({ memberConversations: [] }));
		const sessionServices = {
			...base.sessions,
			readSnapshot: vi.fn(async () => ({
				session: {} as never,
				conversationRevision: 1,
				messages: [],
				activities: [],
			})),
			displayProjection: displayProjection,
		};
		registerAgentTeamsIpc({ ...base, sessions: sessionServices as AgentTeamsIpcDependencies["sessions"] });
		const getSession = ipc.handlers.get("vetta:agent-teams:get-session");
		if (!getSession) throw new Error("get-session handler was not registered");

		await expect(
			getSession({}, { id: "session", coordinationSessionPath: "C:/runtime/session.jsonl" }),
		).resolves.toMatchObject({
			display: { memberConversations: [] },
		});
		expect(displayProjection).toHaveBeenCalledOnce();
	});

	it("creates every Team session in the Team-owned workspace and lists the Team catalog", async () => {
		const deps = dependencies();
		const document = createAgentTeamFixture();
		const team = document.teams[0];
		if (!team) throw new Error("missing Team fixture");
		deps.store.read = vi.fn(async () => document);
		deps.sessions.create = vi.fn(async (_team, _document, cwd) => ({ cwd }) as never);
		deps.sessions.listSessions = vi.fn(async () => []);
		registerAgentTeamsIpc(deps);

		const createSession = ipc.handlers.get("vetta:agent-teams:create-session");
		const listSessions = ipc.handlers.get("vetta:agent-teams:list-sessions");
		if (!createSession || !listSessions) throw new Error("Team session handlers were not registered");
		await createSession({}, team.id);
		await listSessions({}, team.id);

		expect(deps.sessions.create).toHaveBeenCalledWith(team, document, `C:/teams/${team.id}/workspace`);
		expect(deps.sessions.listSessions).toHaveBeenCalledWith(team.id);
	});

	it("creates the visible session record through the lightweight path", async () => {
		const deps = dependencies();
		const document = createAgentTeamFixture();
		const team = document.teams[0];
		if (!team) throw new Error("missing Team fixture");
		deps.store.read = vi.fn(async () => document);
		deps.sessions.createRecord = vi.fn(async (_team, _document, cwd) => ({ cwd }) as never);
		registerAgentTeamsIpc(deps);

		const createSessionRecord = ipc.handlers.get("vetta:agent-teams:create-session-record");
		if (!createSessionRecord) throw new Error("create-session-record handler was not registered");
		await createSessionRecord({}, team.id);

		expect(deps.sessions.createRecord).toHaveBeenCalledWith(team, document, `C:/teams/${team.id}/workspace`);
		expect(deps.sessions.create).not.toHaveBeenCalled();
	});

	it("validates and forwards Team-session model settings", async () => {
		const deps = dependencies();
		registerAgentTeamsIpc(deps);
		const updateModelSettings = ipc.handlers.get("vetta:agent-teams:update-model-settings");
		if (!updateModelSettings) throw new Error("update-model-settings handler was not registered");

		await updateModelSettings({}, "session", { modelKey: "openai/gpt-5", reasoning: "high" });
		expect(deps.sessions.updateModelSettings).toHaveBeenCalledWith("session", {
			modelKey: "openai/gpt-5",
			reasoning: "high",
		});

		await expect(updateModelSettings({}, "session", { reasoning: "high" })).rejects.toThrow(
			"Invalid Team session model settings input",
		);
	});

	it("validates and forwards the Team-scoped execution mode", async () => {
		const deps = dependencies();
		registerAgentTeamsIpc(deps);
		const setExecutionMode = ipc.handlers.get("vetta:agent-teams:set-execution-mode");
		if (!setExecutionMode) throw new Error("set-execution-mode handler was not registered");

		await setExecutionMode({}, "session", "sandbox");
		expect(deps.sessions.setExecutionMode).toHaveBeenCalledWith("session", "sandbox");
		await expect(setExecutionMode({}, "session", "invalid")).rejects.toThrow("Invalid executionMode");
	});

	it("bridges stream subscriptions and abort requests", async () => {
		const deps = dependencies();
		const streamHandler = vi.fn();
		const unsubscribe = vi.fn();
		deps.sessions.subscribe = vi.fn((_id, handler) => {
			streamHandler.mockImplementation(handler);
			return {
				unsubscribe,
				snapshot: {
					type: "session-snapshot" as const,
					teamSessionId: "session",
					snapshot: {
						session: {
							schemaVersion: 1 as const,
							revision: 0,
							id: "session",
							teamId: "team",
							name: "Team",
							cwd: "C:/workspace",
							leaderMemberId: "leader",
							memberHandles: { leader: "vetta" },
							createdAt: 1,
							updatedAt: 1,
							events: [],
							memberRuntime: {},
						},
						conversationRevision: 0,
						messages: [],
						activities: [],
					},
					activeMessageEvents: [],
				},
			};
		});
		registerAgentTeamsIpc(deps);
		const sender = {
			isDestroyed: () => false,
			send: vi.fn(),
			once: vi.fn(),
			removeListener: vi.fn(),
		};
		const subscribe = ipc.handlers.get("vetta:agent-teams:subscribe");
		if (!subscribe) throw new Error("subscribe handler was not registered");
		const result = (await subscribe({ sender }, "session")) as {
			subscriptionId: string;
			initial: { type: string };
		};
		expect(result.initial.type).toBe("session-snapshot");
		streamHandler({
			type: "conversation.agent-message-discard",
			conversationId: "session",
			messageId: "message",
			turnId: "request",
			author: { kind: "agent", id: "m" },
			sequence: 1,
			reason: "completed",
			timestamp: 1,
		});
		await new Promise<void>((resolve) => queueMicrotask(resolve));
		expect(sender.send).toHaveBeenCalledWith(
			"vetta:agent-teams:stream-event",
			result.subscriptionId,
			expect.objectContaining({ type: "conversation.agent-message-discard", reason: "completed" }),
		);
		const onDestroyed = sender.once.mock.calls[0]?.[1] as (() => void) | undefined;
		onDestroyed?.();
		expect(unsubscribe).toHaveBeenCalledOnce();

		const abort = ipc.handlers.get("vetta:agent-teams:abort");
		if (!abort) throw new Error("abort handler was not registered");
		await abort({}, "session");
		expect(deps.sessions.abort).toHaveBeenCalledWith("session");
	});
});
