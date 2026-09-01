import {
	createInitialAgentTeamDocument,
	type TeamSessionDocument,
	type TeamSessionStreamEvent,
} from "@vetta/agent-team";
import type { RuntimeHost, SessionEvent } from "@vetta/runtime-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamSessionRepository } from "./team-session-repository.js";
import { AgentTeamSessionService } from "./team-session-service.js";

vi.mock("../conversations/resolve-session-config.js", () => ({
	resolveDesktopSessionConfig: vi.fn(async ({ cwd }: { cwd: string }) => ({ config: { cwd } })),
}));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../runtime.js", () => ({ getSharedRuntime: vi.fn() }));

describe("AgentTeamSessionService streaming contract", () => {
	beforeEach(() => vi.clearAllMocks());

	it("publishes ordered deltas and persists the same non-empty final answer", async () => {
		const document = createInitialAgentTeamDocument();
		const team = document.teams[0];
		if (!team) throw new Error("built-in Agent Team fixture is missing");
		const sessions = new Map<string, TeamSessionDocument>();
		const repository: TeamSessionRepository = {
			memberSessionDirectory: (sessionId, memberId) => `C:/sessions/${sessionId}/${memberId}`,
			read: async (id) => {
				const session = sessions.get(id);
				if (!session) throw new Error(`missing session: ${id}`);
				return session;
			},
			write: async (session) => {
				sessions.set(session.id, structuredClone(session));
			},
		};

		let runtimeSequence = 0;
		const runtimeListeners = new Map<string, (event: SessionEvent) => void>();
		const assistantText = "partial answer";
		const runtime = {
			createSession: vi.fn(async () => ({ sessionId: `runtime-${++runtimeSequence}` })),
			getSessionPath: (sessionId: string) => `C:/runtime/${sessionId}.jsonl`,
			disposeSession: vi.fn(async () => undefined),
			subscribe: (sessionId: string, listener: (event: SessionEvent) => void) => {
				runtimeListeners.set(sessionId, listener);
				return () => runtimeListeners.delete(sessionId);
			},
			prompt: vi.fn(async (sessionId: string) => {
				const listener = runtimeListeners.get(sessionId);
				listener?.({ type: "message.delta", delta: "partial ", timestamp: 2 } as SessionEvent);
				listener?.({ type: "message.delta", delta: "answer", timestamp: 3 } as SessionEvent);
				return {};
			}),
			getMessages: () => [
				{
					id: "assistant",
					role: "assistant",
					content: [{ type: "text", text: assistantText }],
				},
			],
			abort: vi.fn(async () => undefined),
		} as unknown as RuntimeHost;
		const service = new AgentTeamSessionService({
			runtime,
			repository,
			readDocument: async () => document,
		});
		const created = await service.create(team, document, "C:/workspace");
		const events: TeamSessionStreamEvent[] = [];
		const subscription = service.subscribe(created.id, (event) => events.push(event));

		const completed = await service.send(created.id, {
			requestId: "request",
			text: "question",
			targetMemberIds: [team.leaderMemberId],
		});
		subscription.unsubscribe();

		expect(
			events
				.filter((event) => event.type !== "session-updated")
				.map((event) => (event.type === "member-delta" ? `${event.type}:${event.delta}` : event.type)),
		).toEqual(["member-start", "member-delta:partial ", "member-delta:answer", "member-end"]);
		expect(events.filter((event) => event.type === "member-delta").map((event) => event.seq)).toEqual([1, 2]);
		expect(completed.events.at(-1)).toMatchObject({ type: "member-result", text: assistantText });
		expect(sessions.get(created.id)?.events.at(-1)).toMatchObject({
			type: "member-result",
			text: assistantText,
		});
		expect(events.at(-1)).toMatchObject({ type: "member-end", phase: "final", seq: 3 });
	});
});
