import {
	AGENT_TEAM_MEMBER_TOOL_EXECUTION,
	AGENT_TEAM_PUBLICATION_LIFECYCLE,
	createAgentTeamExtensionRegistry,
	createInitialAgentTeamDocument,
	type TeamSessionDocument,
	type TeamSessionStreamEvent,
} from "@vetta/agent-team";
import { createAssistantMessage } from "@vetta/ai";
import type {
	RuntimeContextSummaryRequest,
	RuntimeHost,
	RuntimeSessionExecutionObservation,
	SessionConfig,
	SessionEvent,
} from "@vetta/runtime-core";
import type { ConversationMessageRecord } from "@vetta/runtime-core/conversation";
import {
	createRuntimeObservationPublisher,
	type RuntimeObservationContext,
	type RuntimeObservationRecord,
} from "@vetta/runtime-core/observation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LegacyTeamSessionRepository } from "./team-session-repository.js";
import { AgentTeamSessionService } from "./team-session-service.js";

vi.mock("../conversations/resolve-session-config.js", () => ({
	resolveDesktopSessionConfig: vi.fn(async (config: SessionConfig) => ({ config })),
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
		const repository: LegacyTeamSessionRepository = {
			read: async (id) => {
				const session = sessions.get(id);
				if (!session) throw new Error(`missing session: ${id}`);
				return session;
			},
		};

		let runtimeSequence = 0;
		let prompted = false;
		const runtimeListeners = new Map<string, (event: SessionEvent) => void>();
		const executionListeners = new Map<
			string,
			(observation: RuntimeSessionExecutionObservation) => Promise<void> | void
		>();
		const observationRecords: RuntimeObservationRecord[] = [];
		const observationPublisher = createRuntimeObservationPublisher({
			port: {
				record: (record) => {
					observationRecords.push(record);
				},
			},
		});
		const conversationEntries: Array<Record<string, unknown>> = [
			{
				type: "message",
				kind: "user",
				id: "public-1",
				turnId: "public-turn-1",
				timestamp: new Date(1).toISOString(),
				author: { kind: "user", id: "local-user" },
				message: { role: "user", content: "First public decision", timestamp: 1 },
			},
			{
				type: "message",
				kind: "agent",
				id: "public-2",
				turnId: "public-turn-2",
				timestamp: new Date(2).toISOString(),
				author: { kind: "agent", id: team.leaderMemberId },
				message: { role: "assistant", content: [{ type: "text", text: "Second public result" }], timestamp: 2 },
			},
		];
		const assistantText = "partial answer";
		const createSession = vi.fn(async (config?: SessionConfig) => ({
			sessionId: config?.sessionId ?? `runtime-${++runtimeSequence}`,
		}));
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
				const partial = {
					...createAssistantMessage(
						{ api: "openai-responses", provider: "openai", model: "model" },
						{ timestamp: 2 },
					),
					content: [
						{ type: "thinking" as const, thinking: "private execution reasoning" },
						{ type: "text" as const, text: "partial answer" },
						{ type: "toolCall" as const, id: "private-call", name: "read", arguments: { path: "secret" } },
					],
				};
				const assistantEvent = (event: Record<string, unknown>, sequence: number): SessionEvent =>
					({
						schemaVersion: 1,
						channel: "assistant",
						sessionId,
						eventId: `assistant-${sequence}`,
						timestamp: sequence,
						source: "agent",
						sequence,
						turnId: "runtime-turn-1",
						modelCallIndex: 0,
						...event,
					}) as SessionEvent;
				listener?.(assistantEvent({ type: "thinking_delta", contentIndex: 0, delta: "private", partial }, 1));
				listener?.(assistantEvent({ type: "text_delta", contentIndex: 1, delta: "partial ", partial }, 2));
				listener?.(assistantEvent({ type: "toolcall_start", contentIndex: 2, partial }, 3));
				listener?.(assistantEvent({ type: "text_delta", contentIndex: 1, delta: "answer", partial }, 4));
				await executionListeners.get(sessionId)?.({
					turnId: "runtime-turn-1",
					timestamp: 3,
					event: {
						type: "tool.execution.start",
						toolCallId: "tool-call-1",
						toolName: "read",
						args: { path: "C:/workspace/private.txt" },
						startedAt: 2,
					},
				});
				await executionListeners.get(sessionId)?.({
					turnId: "runtime-turn-1",
					timestamp: 4,
					event: {
						type: "tool.execution.end",
						toolCallId: "tool-call-1",
						toolName: "read",
						result: { content: [{ type: "text", text: "private result" }] },
						isError: false,
						startedAt: 2,
						durationMs: 2,
						phases: [],
					},
				});
				prompted = true;
				return {};
			}),
			subscribeExecutionObservations: (
				sessionId: string,
				listener: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
			) => {
				executionListeners.set(sessionId, listener);
				return () => executionListeners.delete(sessionId);
			},
			createObservationScope: (context: RuntimeObservationContext) => observationPublisher.scope(context),
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
			appendConversationMessage: vi.fn(async (_sessionId: string, record: ConversationMessageRecord) => {
				conversationEntries.push({
					type: "message",
					id: record.id,
					turnId: record.turnId,
					kind: record.kind,
					author: record.author,
					message: record.message,
					...(record.kind === "user" && record.attachments?.length ? { attachments: record.attachments } : {}),
				});
				return { entryId: record.id };
			}),
			deliverSessionContext: vi.fn(async () => undefined),
			summarizeSessionContext: vi.fn(async (_sessionId: string, request: RuntimeContextSummaryRequest) => {
				expect(request.records).toHaveLength(2);
				expect(request.records.every((record) => record.modelVisible)).toBe(true);
				expect(JSON.stringify(request.records)).not.toContain("private execution reasoning");
				return { summary: "Shared public decisions summary", tokensBefore: 20 };
			}),
			appendSessionMetadataEntry: vi.fn(async (_sessionId: string, customType: string, data: unknown) => {
				conversationEntries.push({ type: "custom", customType, data });
			}),
			readSessionDocument: () => ({
				entries: conversationEntries,
				activeLeafId: "assistant-entry",
				revision: conversationEntries.length,
			}),
			abort: vi.fn(async () => undefined),
		} as unknown as RuntimeHost;
		const service = new AgentTeamSessionService({
			runtime,
			repository,
			readDocument: async () => document,
			sharedContextCompaction: { maxCharacters: 1, keepRecentCharacters: 0 },
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
		await observationPublisher.flush();
		subscription.unsubscribe();

		const messageEvents = events.filter((event) => event.type === "conversation.agent-message-event");
		expect(
			messageEvents.map((event) => (event.event.type === "text_delta" ? event.event.delta : event.event.type)),
		).toEqual(["partial ", "answer"]);
		expect(messageEvents.map((event) => event.sequence)).toEqual([1, 2]);
		expect(completed.events).toEqual([]);
		expect(service.snapshot(completed).messages.at(-1)).toMatchObject({
			kind: "agent",
			author: { id: team.leaderMemberId },
			message: { content: [{ type: "text", text: assistantText }] },
		});
		expect(events.at(-1)).toMatchObject({
			type: "conversation.agent-message-discard",
			reason: "completed",
			sequence: 3,
		});
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
		expect(runtime.summarizeSessionContext).toHaveBeenCalledOnce();
		const toolObservations = observationRecords.filter((record) => record.token === AGENT_TEAM_MEMBER_TOOL_EXECUTION);
		expect(toolObservations).toHaveLength(2);
		expect(toolObservations.map(({ payload }) => payload)).toEqual([
			expect.objectContaining({
				participantId: team.leaderMemberId,
				requestTurnId: "request",
				runtimeTurnId: "runtime-turn-1",
				toolCallId: "tool-call-1",
				toolName: "read",
				phase: "started",
				inputFieldCount: 1,
				workItemId: expect.any(String),
				attemptId: expect.any(String),
			}),
			expect.objectContaining({
				phase: "completed",
				contentItemCount: 1,
				hasDetails: false,
				durationMs: 2,
				isError: false,
			}),
		]);
		expect(JSON.stringify(toolObservations)).not.toContain("C:/workspace/private.txt");
		expect(JSON.stringify(toolObservations)).not.toContain("private result");
		const publicationObservations = observationRecords.filter(
			(record) => record.token === AGENT_TEAM_PUBLICATION_LIFECYCLE,
		);
		expect(publicationObservations.map(({ payload }) => payload)).toEqual([
			expect.objectContaining({
				phase: "prepared",
				participantId: team.leaderMemberId,
				requestTurnId: "request",
				workItemId: expect.any(String),
				attemptId: expect.any(String),
				sourceParticipantConversationId: expect.stringMatching(/^runtime-/),
				sourceMessageEntryId: "assistant-entry",
				generation: 1,
				recovered: false,
			}),
			expect.objectContaining({ phase: "message-published", recovered: false }),
			expect.objectContaining({
				phase: "completed",
				resultMessageId: expect.any(String),
				recovered: false,
			}),
		]);
		expect(
			conversationEntries.find(
				(entry) => entry.type === "custom" && entry.customType === "agent-team.shared-checkpoint.v1",
			)?.data,
		).toMatchObject({
			sourceEntryIds: ["public-1", "public-2"],
			summarizedSourceEntryIds: ["public-1", "public-2"],
			summaryRecords: [
				{
					kind: "summary",
					content: expect.stringContaining('"summary":"Shared public decisions summary"'),
				},
			],
		});
	});

	it("reconciles cached sessions after members are added or removed", async () => {
		let document = createInitialAgentTeamDocument();
		const originalTeam = document.teams[0];
		if (!originalTeam) throw new Error("built-in Agent Team fixture is missing");
		const removedMember = originalTeam.members.at(-1);
		const sourceMember = originalTeam.members[1];
		if (!removedMember || !sourceMember) throw new Error("built-in Agent Team member fixture is missing");
		const sessions = new Map<string, TeamSessionDocument>();
		const repository: LegacyTeamSessionRepository = {
			read: async (id) => {
				const session = sessions.get(id);
				if (!session) throw new Error(`missing session: ${id}`);
				return session;
			},
		};
		let runtimeSequence = 0;
		const runtime = {
			createSession: vi.fn(async (config?: SessionConfig) => ({
				sessionId: config?.sessionId ?? `runtime-${++runtimeSequence}`,
			})),
			getSessionPath: (sessionId: string) => `C:/runtime/${sessionId}.jsonl`,
			disposeSession: vi.fn(async () => undefined),
			subscribe: () => () => undefined,
			appendConversationMessage: vi.fn(async () => ({ entryId: "entry" })),
			appendSessionMetadataEntry: vi.fn(async () => undefined),
			readSessionDocument: () => ({ entries: [], activeLeafId: null, revision: 0 }),
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
		expect(reconciled.memberRuntime[addedMember.id]?.sessionId).toBe(`runtime-${originalTeam.members.length + 1}`);
		expect(reconciled.memberHandles[removedMember.id]).toBe(removedMember.handle);
		expect(runtime.disposeSession).toHaveBeenCalledWith(`runtime-${originalTeam.members.length}`);
	});

	it("keeps a work item waiting when a member turn has no publishable final message", async () => {
		const document = createInitialAgentTeamDocument();
		const team = document.teams[0];
		if (!team) throw new Error("built-in Agent Team fixture is missing");
		const sessions = new Map<string, TeamSessionDocument>();
		const entries: Array<Record<string, unknown>> = [];
		const repository: LegacyTeamSessionRepository = {
			read: async (id) => {
				const session = sessions.get(id);
				if (!session) throw new Error(`missing session: ${id}`);
				return session;
			},
		};
		let sequence = 0;
		const runtime = {
			createSession: vi.fn(async (config?: SessionConfig) => ({
				sessionId: config?.sessionId ?? `runtime-${++sequence}`,
			})),
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
			deliverSessionContext: vi.fn(async () => undefined),
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
		expect(stream.at(-1)).toMatchObject({
			type: "conversation.agent-message-discard",
			reason: "waiting",
		});
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
			const repository: LegacyTeamSessionRepository = {
				read: async (id) => {
					const session = sessions.get(id);
					if (!session) throw new Error(`missing session: ${id}`);
					return session;
				},
			};
			let sequence = 0;
			const runtime = {
				createSession: vi.fn(async (config?: SessionConfig) => ({
					sessionId: config?.sessionId ?? `runtime-${++sequence}`,
				})),
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
				expect(runtime.deliverSessionContext).toHaveBeenCalledWith(
					expect.any(String),
					[
						expect.objectContaining({
							type: "agent-team.compaction-reference.v1",
							modelVisible: false,
						}),
					],
					"record",
				);
			} else {
				expect(runtime.deliverSessionContext).toHaveBeenCalledWith(
					expect.any(String),
					[
						expect.objectContaining({
							type: "agent-team.compaction-reference.v1",
							modelVisible: false,
						}),
					],
					"record",
				);
			}
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
