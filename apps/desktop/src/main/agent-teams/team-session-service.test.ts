import {
	createAgentTeamExtensionRegistry,
	createInitialAgentTeamDocument,
	type TeamSessionDocument,
	type TeamSessionStreamEvent,
} from "@vetta/agent-team";
import { createAssistantMessage } from "@vetta/ai";
import type { RuntimeHost, SessionConfig, SessionEvent } from "@vetta/runtime-core";
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
		let prompted = false;
		const runtimeListeners = new Map<string, (event: SessionEvent) => void>();
		const conversationEntries: Array<Record<string, unknown>> = [];
		const assistantText = "partial answer";
		const createSession = vi.fn(async (_config?: SessionConfig) => ({ sessionId: `runtime-${++runtimeSequence}` }));
		const runtime = {
			createSession,
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
				prompted = true;
				return {};
			}),
			getFullHistory: () =>
				prompted
					? [
							{
								type: "message",
								entryId: "assistant-entry",
								message: {
									...createAssistantMessage(
										{ api: "openai-responses", provider: "openai", model: "model" },
										{ timestamp: 3 },
									),
									content: [
										{ type: "thinking", thinking: "private execution reasoning" },
										{ type: "text", text: assistantText },
									],
								},
							},
						]
					: [],
			appendConversationMessage: vi.fn(async () => ({ entryId: "entry" })),
			appendSessionMetadataEntry: vi.fn(async (_sessionId: string, customType: string, data: unknown) => {
				conversationEntries.push({ type: "custom", customType, data });
			}),
			readSessionDocument: () => ({ entries: conversationEntries, activeLeafId: "assistant-entry" }),
			abort: vi.fn(async () => undefined),
		} as unknown as RuntimeHost;
		const service = new AgentTeamSessionService({
			runtime,
			repository,
			readDocument: async () => document,
		});
		const created = await service.create(team, document, "C:/workspace");
		expect(createSession.mock.calls.every(([config]) => config === undefined || !("sessionDir" in config))).toBe(
			true,
		);
		const events: TeamSessionStreamEvent[] = [];
		const subscription = service.subscribe(created.id, (event) => events.push(event));

		const completed = await service.send(created.id, {
			requestId: "request",
			text: "question",
			targetMemberIds: [team.leaderMemberId],
			attachments: [{ kind: "file", path: "C:/workspace/brief.md" }],
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
		expect(runtime.prompt).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				attachments: [{ kind: "file", path: "C:/workspace/brief.md" }],
			}),
		);
		expect(runtime.appendConversationMessage).toHaveBeenCalledTimes(2);
		expect(runtime.appendConversationMessage).toHaveBeenNthCalledWith(
			2,
			expect.any(String),
			expect.objectContaining({
				kind: "agent",
				message: expect.objectContaining({ content: [{ type: "text", text: assistantText }] }),
			}),
		);
	});

	it("reconciles cached sessions after members are added or removed", async () => {
		let document = createInitialAgentTeamDocument();
		const originalTeam = document.teams[0];
		if (!originalTeam) throw new Error("built-in Agent Team fixture is missing");
		const removedMember = originalTeam.members.at(-1);
		const sourceMember = originalTeam.members[1];
		if (!removedMember || !sourceMember) throw new Error("built-in Agent Team member fixture is missing");
		const sessions = new Map<string, TeamSessionDocument>();
		const repository: TeamSessionRepository = {
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
		const runtime = {
			createSession: vi.fn(async () => ({ sessionId: `runtime-${++runtimeSequence}` })),
			getSessionPath: (sessionId: string) => `C:/runtime/${sessionId}.jsonl`,
			disposeSession: vi.fn(async () => undefined),
			subscribe: () => () => undefined,
			appendConversationMessage: vi.fn(async () => ({ entryId: "entry" })),
		} as unknown as RuntimeHost;
		const service = new AgentTeamSessionService({
			runtime,
			repository,
			readDocument: async () => document,
		});
		const created = await service.create(originalTeam, document, "C:/workspace");
		const addedMember = {
			...sourceMember,
			id: "member-added",
			handle: "additional-reviewer",
		};
		const nextTeam = {
			...originalTeam,
			revision: originalTeam.revision + 1,
			members: [...originalTeam.members.filter((member) => member.id !== removedMember.id), addedMember],
		};
		document = {
			...document,
			revision: document.revision + 1,
			teams: document.teams.map((team) => (team.id === nextTeam.id ? nextTeam : team)),
		};

		const reconciled = await service.read(created.id);

		expect(reconciled.teamRevision).toBe(nextTeam.revision);
		expect(reconciled.activeMemberIds).toEqual(nextTeam.members.map((member) => member.id));
		expect(reconciled.memberRuntime[removedMember.id]).toBeUndefined();
		expect(reconciled.memberRuntime[addedMember.id]?.sessionId).toBe(`runtime-${originalTeam.members.length + 2}`);
		expect(reconciled.memberHandles[removedMember.id]).toBe(removedMember.handle);
		expect(runtime.disposeSession).toHaveBeenCalledWith(`runtime-${originalTeam.members.length + 1}`);
	});

	it("keeps a work item waiting when a member turn has no publishable final message", async () => {
		const document = createInitialAgentTeamDocument();
		const team = document.teams[0];
		if (!team) throw new Error("built-in Agent Team fixture is missing");
		const sessions = new Map<string, TeamSessionDocument>();
		const entries: Array<Record<string, unknown>> = [];
		const repository: TeamSessionRepository = {
			read: async (id) => {
				const session = sessions.get(id);
				if (!session) throw new Error(`missing session: ${id}`);
				return session;
			},
			write: async (session) => {
				sessions.set(session.id, structuredClone(session));
			},
		};
		let sequence = 0;
		const runtime = {
			createSession: vi.fn(async () => ({ sessionId: `runtime-${++sequence}` })),
			getSessionPath: (sessionId: string) => `C:/runtime/${sessionId}.jsonl`,
			disposeSession: vi.fn(async () => undefined),
			subscribe: () => () => undefined,
			prompt: vi.fn(async () => ({})),
			getMessages: () => [
				{
					role: "assistant",
					content: [{ type: "text", text: "result from an earlier turn" }],
				},
			],
			getFullHistory: () => [],
			appendConversationMessage: vi.fn(async () => ({ entryId: "entry" })),
			appendSessionMetadataEntry: vi.fn(async (_sessionId: string, customType: string, data: unknown) => {
				entries.push({ type: "custom", customType, data });
			}),
			readSessionDocument: () => ({ entries, activeLeafId: null }),
			abort: vi.fn(async () => undefined),
		} as unknown as RuntimeHost;
		const service = new AgentTeamSessionService({
			runtime,
			repository,
			readDocument: async () => document,
		});
		const created = await service.create(team, document, "C:/workspace");
		const stream: TeamSessionStreamEvent[] = [];
		service.subscribe(created.id, (event) => stream.push(event));

		const result = await service.send(created.id, {
			requestId: "request-no-final",
			text: "do work",
			targetMemberIds: [team.leaderMemberId],
		});
		const collaboration = await service.readCollaborationState(created.id);

		expect(result.events.some((event) => event.type === "member-result")).toBe(false);
		expect(collaboration.workItems).toHaveLength(1);
		expect(collaboration.workItems[0]?.state).toBe("waiting");
		expect(collaboration.attempts[0]?.state).toBe("interrupted");
		expect(stream.at(-1)).toMatchObject({ type: "member-end", phase: "waiting" });
	});

	it.each([true, false])(
		"honors the context policy before delivery and handles network interruption (allowed=%s)",
		async (allowed) => {
			const document = createInitialAgentTeamDocument();
			const team = document.teams[0];
			if (!team) throw new Error("built-in Agent Team fixture is missing");
			const sessions = new Map<string, TeamSessionDocument>();
			const entries: Array<Record<string, unknown>> = [
				{
					type: "message",
					kind: "user",
					id: "earlier-user-message",
					turnId: "earlier-request",
					timestamp: new Date(1).toISOString(),
					author: { kind: "user", id: "local-user" },
					message: { role: "user", content: "Earlier public context", timestamp: 1 },
				},
			];
			const repository: TeamSessionRepository = {
				read: async (id) => {
					const session = sessions.get(id);
					if (!session) throw new Error(`missing session: ${id}`);
					return session;
				},
				write: async (session) => {
					sessions.set(session.id, structuredClone(session));
				},
			};
			let sequence = 0;
			const runtime = {
				createSession: vi.fn(async () => ({ sessionId: `runtime-${++sequence}` })),
				getSessionPath: (sessionId: string) => `C:/runtime/${sessionId}.jsonl`,
				disposeSession: vi.fn(async () => undefined),
				subscribe: () => () => undefined,
				prompt: vi.fn(async () => ({})),
				getMessages: () => [],
				getFullHistory: () => [],
				appendConversationMessage: vi.fn(async () => ({ entryId: "entry" })),
				appendSessionMetadataEntry: vi.fn(async (_sessionId: string, customType: string, data: unknown) => {
					entries.push({ type: "custom", customType, data });
				}),
				readSessionDocument: () => ({ entries, activeLeafId: null, revision: 1 }),
				deliverSessionContext: vi.fn(async () => {
					throw {
						code: "provider_network_timeout",
						message: "network timeout",
						retryable: true,
						origin: "provider",
					};
				}),
				abort: vi.fn(async () => undefined),
			} as unknown as RuntimeHost;
			const service = new AgentTeamSessionService({
				runtime,
				repository,
				readDocument: async () => document,
				extensions: allowed
					? undefined
					: createAgentTeamExtensionRegistry([
							{
								contextPolicies: new Map([
									["public-results-v1", { id: "public-results-v1", project: () => [] }],
								]),
							},
						]),
			});
			const created = await service.create(team, document, "C:/workspace");
			await expect(
				service.send(created.id, {
					requestId: "request-context-failure",
					text: "continue the work",
					targetMemberIds: [team.leaderMemberId],
				}),
			).resolves.toBeDefined();
			const collaboration = await service.readCollaborationState(created.id);

			if (!allowed) {
				expect(runtime.deliverSessionContext).not.toHaveBeenCalled();
				expect(runtime.prompt).toHaveBeenCalled();
				return;
			}
			expect(runtime.deliverSessionContext).toHaveBeenCalledWith(
				expect.any(String),
				[
					expect.objectContaining({
						content: expect.stringContaining('"author":{"kind":"user","id":"local-user"}'),
					}),
				],
				"record",
			);
			expect(runtime.prompt).not.toHaveBeenCalled();
			expect(collaboration.workItems[0]).toMatchObject({
				state: "waiting",
				lastIssue: { category: "network", retryability: "automatic" },
			});
			expect(collaboration.attempts[0]).toMatchObject({
				state: "waiting-retry",
				issue: { category: "network", retryability: "automatic" },
			});
		},
	);
});
