import { createEmptyAgentTeamDocument } from "@vetta/agent-team";
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

function dependencies(): AgentTeamsIpcDependencies {
	return {
		store: {
			read: vi.fn(async () => createEmptyAgentTeamDocument()),
			listBlueprints: vi.fn(async () => []),
			createAgent: vi.fn(async (input) => ({ ...input, id: "agent" })),
			updateAgent: vi.fn(),
			deleteAgent: vi.fn(),
			previewAgentUpdate: vi.fn(),
			createTeam: vi.fn(),
		},
		sessions: {
			create: vi.fn(),
			read: vi.fn(),
			send: vi.fn(),
			subscribe: vi.fn(() => vi.fn()),
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

	it("rejects unknown message fields and removes every registered handler", () => {
		const deps = dependencies();
		const teardown = registerAgentTeamsIpc(deps);
		const sendMessage = ipc.handlers.get("vetta:agent-teams:send-message");
		if (!sendMessage) throw new Error("send-message handler was not registered");

		expect(() =>
			sendMessage({}, "session", { requestId: "request", text: "Hello", targetMemberIds: [], privateTrace: true }),
		).toThrow("Invalid send team message input");
		expect(deps.sessions.send).not.toHaveBeenCalled();

		teardown();
		expect(ipc.removed).toHaveLength(ipc.handlers.size);
	});

	it("bridges stream subscriptions and abort requests", async () => {
		const deps = dependencies();
		const streamHandler = vi.fn();
		deps.sessions.subscribe = vi.fn((_id, handler) => {
			streamHandler.mockImplementation(handler);
			return vi.fn();
		});
		registerAgentTeamsIpc(deps);
		const sender = { isDestroyed: () => false, send: vi.fn() };
		const subscribe = ipc.handlers.get("vetta:agent-teams:subscribe");
		if (!subscribe) throw new Error("subscribe handler was not registered");
		const result = (await subscribe({ sender }, "session")) as { subscriptionId: string };
		streamHandler({ type: "member-delta", teamSessionId: "session", memberId: "m", requestId: "r", delta: "hi" });
		expect(sender.send).toHaveBeenCalledWith(
			"vetta:agent-teams:stream-event",
			result.subscriptionId,
			expect.objectContaining({ type: "member-delta", delta: "hi" }),
		);

		const abort = ipc.handlers.get("vetta:agent-teams:abort");
		if (!abort) throw new Error("abort handler was not registered");
		await abort({}, "session");
		expect(deps.sessions.abort).toHaveBeenCalledWith("session");
	});
});
