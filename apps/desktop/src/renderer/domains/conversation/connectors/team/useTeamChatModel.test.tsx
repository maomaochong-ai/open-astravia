// @vitest-environment jsdom

import {
	createAgentTeamFixture,
	type TeamSessionDocument,
	type TeamSessionSnapshot,
} from "@vetta/agent-team";
import type { DesktopTeamSessionStreamEvent, DesktopTeamSessionSnapshot } from "@preload/api-types/team-conversation-display";
import { createAssistantMessage } from "@vetta/ai";
import type { ContextCompositionReport } from "@vetta/runtime-core";
import { reasoningByModelAtom, selectedModelAtom } from "@shared/store/atoms";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { StrictMode, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_SESSIONS_CHANGED_EVENT } from "../../../../shared/agent-teams/team-session-events";
import { useTeamChatModel } from "./useTeamChatModel";
import {
	createReservedTeamChatSession,
	createTeamChatSession,
	loadTeamChatBootstrap,
	loadTeamChatSession,
} from "./team-chat-session-service";
import { peekTeamSessionHandoff, stageTeamSessionHandoff, takeTeamSessionHandoff } from "./team-session-handoff";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { writeCachedContextComposition } from "../../services/context-composition-cache";

vi.mock("@shared/hooks/useRendererMarkdownModel", () => ({
	useRendererMarkdownModel: () => ({
		theme: "light",
		labels: { copy: "Copy", copied: "Copied" },
		getFileIconClass: () => "icon",
		onOpenFile: vi.fn(),
		onOpenUrl: vi.fn(),
	}),
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, string>) =>
			values ? `${key}:${Object.values(values).join(":")}` : key,
	}),
}));
vi.mock("./team-chat-session-service", () => ({
	loadTeamChatSession: vi.fn(),
	loadTeamChatBootstrap: vi.fn(),
	createTeamChatSession: vi.fn(),
	createReservedTeamChatSession: vi.fn(),
}));
vi.mock("@shared/lib/committed-paint", () => ({
	waitForCommittedPaint: vi.fn(),
}));

const document = createAgentTeamFixture();
const team = document.teams[0];
if (!team) throw new Error("built-in Agent Team fixture is missing");
const leader = team.members.find((member) => member.id === team.leaderMemberId);
if (!leader) throw new Error("built-in Agent Team leader fixture is missing");

const baseSession: TeamSessionDocument = {
	schemaVersion: 1,
	revision: 0,
	id: "team-session",
	teamId: team.id,
	name: team.name,
	cwd: "C:/workspace",
	orchestrationPolicyId: team.orchestrationPolicyId,
	contextPolicyId: team.contextPolicyId,
	leaderMemberId: leader.id,
	memberHandles: Object.fromEntries(team.members.map((member) => [member.id, member.handle])),
	createdAt: 1,
	updatedAt: 1,
	events: [],
	memberRuntime: {},
};
const baseSnapshot: DesktopTeamSessionSnapshot = {
	session: baseSession,
	conversationRevision: 0,
	messages: [],
	activities: [],
};

function streamEvent(sequence: number, delta: string, turnId = "request"): DesktopTeamSessionStreamEvent {
	const partial = {
		...createAssistantMessage(
			{ api: "agent-team-test", provider: "agent-team-test", model: "fixture" },
			{ timestamp: sequence },
		),
		content: [{ type: "text" as const, text: delta }],
	};
	return {
		type: "conversation.agent-message-event",
		conversationId: baseSession.id,
		messageId: "result",
		turnId,
		author: { kind: "agent", id: team.leaderMemberId },
		sequence,
		timestamp: sequence,
		event: { type: "text_delta", contentIndex: 0, delta, partial },
	};
}

describe("useTeamChatModel streaming flow", () => {
	let streamListener: ((event: DesktopTeamSessionStreamEvent) => void) | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		streamListener = undefined;
		vi.mocked(waitForCommittedPaint).mockResolvedValue("painted");
		vi.mocked(loadTeamChatBootstrap).mockResolvedValue({ document, sessions: [] });
		vi.mocked(loadTeamChatSession).mockResolvedValue({
			document,
			snapshot: baseSnapshot,
			sessions: [
				{
					id: baseSession.id,
					coordinationSessionPath: "C:/sessions/team.conversation.jsonl",
					title: baseSession.name,
					createdAt: baseSession.createdAt,
					updatedAt: baseSession.updatedAt,
				},
			],
		});
		vi.mocked(createTeamChatSession).mockResolvedValue({
			document,
			snapshot: baseSnapshot,
			sessions: [],
		});
		vi.mocked(createReservedTeamChatSession).mockResolvedValue({
			document,
			snapshot: baseSnapshot,
			sessions: [],
		});
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				agentTeams: {
					subscribe: vi.fn(
						async (_sessionId: string, listener: (event: DesktopTeamSessionStreamEvent) => void) => {
						streamListener = listener;
						return () => undefined;
						},
					),
					sendMessage: vi.fn(async () => baseSnapshot),
					updateModelSettings: vi.fn(async (_id, settings) => ({
						...baseSnapshot,
						session: { ...baseSession, modelSettings: settings },
					})),
					setExecutionMode: vi.fn(async () => baseSnapshot),
					abort: vi.fn(),
				},
				dialog: {
					selectFiles: vi.fn(async () => ["C:/workspace/brief.md"]),
					selectImages: vi.fn(async () => []),
				},
			},
		});
	});

	it("distinguishes target runtime loading from waiting for the model response", async () => {
		let resolveSend: ((value: DesktopTeamSessionSnapshot) => void) | undefined;
		vi.mocked(window.vetta.agentTeams.sendMessage).mockReturnValueOnce(
			new Promise((resolve) => {
				resolveSend = resolve;
			}),
		);
		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));
		await waitFor(() => expect(streamListener).toBeTypeOf("function"));

		act(() => result.current.actions.setDraft("hello team"));
		let sendPromise: Promise<void> | undefined;
		act(() => {
			sendPromise = result.current.actions.send();
		});
		await waitFor(() => expect(window.vetta.agentTeams.sendMessage).toHaveBeenCalledTimes(1));
		expect(result.current.model.pendingLabel).toBe("chat.teamLoading");
		const requestId = vi.mocked(window.vetta.agentTeams.sendMessage).mock.calls[0]?.[1].requestId;
		if (!requestId) throw new Error("send request id is missing");

		act(() => {
			streamListener?.({
				type: "session-updated",
				teamSessionId: baseSession.id,
				snapshot: {
					...baseSnapshot,
					session: {
						...baseSession,
						revision: 1,
						memberRuntime: {
							[leader.id]: {
								sessionId: "leader-runtime",
								sessionPath: "C:/sessions/leader.jsonl",
								agentProfileRevision: 1,
								deliveredEventIds: [],
							},
						},
					},
				},
			});
		});
		await waitFor(() => expect(result.current.model.pendingLabel).toBe("chat.waitingModel"));

		act(() => streamListener?.(streamEvent(1, "partial", requestId)));
		expect(result.current.model.pendingLabel).toBeUndefined();

		await act(async () => {
			resolveSend?.(baseSnapshot);
			await sendPromise;
		});
	});

	it("refreshes Team conversation lists when the automatic title arrives", async () => {
		const changed = vi.fn();
		window.addEventListener(TEAM_SESSIONS_CHANGED_EVENT, changed);
		try {
			const { result } = renderHook(() => useTeamChatModel(team.id));
			await waitFor(() => expect(streamListener).toBeTypeOf("function"));

			act(() => {
				streamListener?.({
					type: "session-updated",
					teamSessionId: baseSession.id,
					snapshot: {
						...baseSnapshot,
						session: { ...baseSession, revision: 1, title: "Review deployment plan" },
					},
				});
			});

			expect(changed).toHaveBeenCalledOnce();
			expect((changed.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ teamId: team.id });
			expect(result.current.model.sessions).toContainEqual({ id: baseSession.id, label: "Review deployment plan" });
		} finally {
			window.removeEventListener(TEAM_SESSIONS_CHANGED_EVENT, changed);
		}
	});

	it("shows ordered partial text and keeps the persisted final result after the stream closes", async () => {
		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));
		await waitFor(() => expect(streamListener).toBeTypeOf("function"));

		act(() => {
			streamListener?.(streamEvent(1, "partial "));
			streamListener?.(streamEvent(2, "answer"));
		});

		expect(result.current.model.status).toBe("streaming");
		expect(result.current.model.members.find((member) => member.id === leader.id)?.status).toBe("working");
		expect(result.current.model.feedItems).toEqual([
			expect.objectContaining({
				kind: "agent",
				phase: "streaming",
				blocks: [expect.objectContaining({ type: "text", text: "partial answer" })],
			}),
		]);

		const finalSession: TeamSessionDocument = {
			...baseSession,
			revision: 1,
			updatedAt: 5,
		};
		const finalSnapshot: DesktopTeamSessionSnapshot = {
			session: finalSession,
			conversationRevision: 1,
			messages: [
				{
					kind: "agent",
					id: "result",
					turnId: "request",
					author: { kind: "agent", id: leader.id },
					message: {
						...createAssistantMessage(
							{ api: "agent-team-test", provider: "agent-team-test", model: "fixture" },
							{ timestamp: 5 },
						),
						content: [{ type: "text", text: "partial answer" }],
					},
					timestamp: 5,
				},
			],
			activities: [],
		};
		act(() => {
			streamListener?.({
				type: "session-updated",
				teamSessionId: baseSession.id,
				snapshot: finalSnapshot,
			});
			streamListener?.({
				type: "conversation.agent-message-discard",
				conversationId: baseSession.id,
				messageId: "result",
				turnId: "request",
				author: { kind: "agent", id: leader.id },
				sequence: 3,
				reason: "completed",
				timestamp: 5,
			});
		});

		expect(result.current.model.status).toBe("ready");
		expect(result.current.model.members.find((member) => member.id === leader.id)?.status).toBe("idle");
		expect(result.current.model.feedItems).toEqual([
			expect.objectContaining({
				kind: "agent",
				phase: "completed",
				blocks: [expect.objectContaining({ type: "text", text: "partial answer" })],
			}),
		]);
	});

	it("restores the running session and member state from durable work before live replay arrives", async () => {
		const runningSnapshot: DesktopTeamSessionSnapshot = {
			...baseSnapshot,
			display: {
				memberConversations: [],
				workingMemberIds: [leader.id],
			},
		};
		vi.mocked(loadTeamChatSession).mockResolvedValueOnce({
			document,
			snapshot: runningSnapshot,
			sessions: [],
		});

		const { result } = renderHook(() => useTeamChatModel(team.id));

		await waitFor(() => expect(result.current.model.status).toBe("streaming"));
		expect(result.current.model.members.find((member) => member.id === leader.id)?.status).toBe("working");

		act(() => {
			streamListener?.({
				type: "session-updated",
				teamSessionId: baseSession.id,
				snapshot: { ...baseSnapshot, session: { ...baseSession, revision: 1 } },
			});
		});
		await waitFor(() => expect(result.current.model.status).toBe("ready"));
		expect(result.current.model.members.find((member) => member.id === leader.id)?.status).toBe("idle");
	});

	it("keeps one visible turn when a tool-only stream overlaps its persisted snapshot", async () => {
		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));
		await waitFor(() => expect(streamListener).toBeTypeOf("function"));

		const toolMessage = {
			...createAssistantMessage(
				{ api: "agent-team-test", provider: "agent-team-test", model: "fixture" },
				{ timestamp: 2 },
			),
			content: [
				{
					type: "toolCall" as const,
					id: "delegate-call",
					name: "team_delegate_task",
					arguments: { memberId: "executor" },
				},
			],
		};
		act(() => {
			streamListener?.({
				type: "conversation.agent-message-event",
				conversationId: baseSession.id,
				messageId: "public-tool-step",
				turnId: "request",
				author: { kind: "agent", id: leader.id },
				sequence: 1,
				timestamp: 2,
				event: { type: "text_delta", contentIndex: 1, delta: "", partial: toolMessage },
			});
		});
		expect(result.current.model.feedItems.filter((item) => item.kind === "agent")).toHaveLength(1);

		act(() => {
			streamListener?.({
				type: "session-updated",
				teamSessionId: baseSession.id,
				snapshot: {
					...baseSnapshot,
					session: { ...baseSession, revision: 1 },
					conversationRevision: 1,
					messages: [
						{
							kind: "agent",
							id: "public-tool-step",
							turnId: "request",
							author: { kind: "agent", id: leader.id },
							message: { ...toolMessage, stopReason: "toolUse" },
							timestamp: 2,
						},
					],
					display: {
						memberConversations: [
							{
								memberId: leader.id,
								runtimeSessionId: "leader-runtime",
								history: [
									{
										type: "message",
										entryId: "runtime-tool-step",
										message: toolMessage,
									},
								],
							},
						],
					},
				},
			});
		});

		expect(result.current.model.feedItems.filter((item) => item.kind === "agent")).toEqual([
			expect.objectContaining({
				id: "public-tool-step",
				renderKey: `team:agent-turn:${leader.id}:request`,
			}),
		]);
	});

	it("keeps a failed member visible until that member starts replying again", async () => {
		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));
		await waitFor(() => expect(streamListener).toBeTypeOf("function"));

		act(() => {
			streamListener?.(streamEvent(1, "partial"));
			streamListener?.({
				type: "conversation.agent-message-discard",
				conversationId: baseSession.id,
				messageId: "result",
				turnId: "request",
				author: { kind: "agent", id: leader.id },
				sequence: 2,
				reason: "failed",
				error: "provider failed",
				timestamp: 2,
			});
		});
		expect(result.current.model.members.find((member) => member.id === leader.id)?.status).toBe("error");

		act(() => streamListener?.(streamEvent(3, "retry")));
		expect(result.current.model.members.find((member) => member.id === leader.id)?.status).toBe("working");
	});

	it("keeps attachment tokens and structured request data in sync", async () => {
		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));

		await act(async () => result.current.actions.selectFiles());
		expect(result.current.model.canSend).toBe(true);
		await act(async () => result.current.actions.send());

		expect(window.vetta.agentTeams.sendMessage).toHaveBeenCalledWith(
			baseSession.id,
			expect.objectContaining({
				text: "@C:/workspace/brief.md",
				attachments: [{ kind: "file", path: "C:/workspace/brief.md" }],
			}),
		);
	});

	it("routes and persists only structured member tokens, not plain @handle text", async () => {
		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));

		act(() => result.current.actions.setDraft(`plain @${leader.handle}`));
		await act(async () => result.current.actions.send());
		expect(window.vetta.agentTeams.sendMessage).toHaveBeenLastCalledWith(
			baseSession.id,
			expect.objectContaining({ targetMemberIds: [], memberMentions: [] }),
		);

		const text = `**ask** @${leader.handle}`;
		act(() =>
			result.current.actions.setDraft(text, [
				{ kind: "text", text: "**ask** " },
				{ kind: "member", memberId: leader.id, handle: leader.handle, label: leader.handle },
			]),
		);
		await act(async () => result.current.actions.send());
		expect(window.vetta.agentTeams.sendMessage).toHaveBeenLastCalledWith(
			baseSession.id,
			expect.objectContaining({
				text,
				targetMemberIds: [leader.id],
				memberMentions: [
					{ participantId: leader.id, handle: leader.handle, start: 8, end: 8 + leader.handle.length + 1 },
				],
			}),
		);
	});

	it("persists model configuration on the active Team session and uses it for prompts", async () => {
		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));

		await act(async () => result.current.actions.selectModel("openai/gpt-5"));
		expect(window.vetta.agentTeams.updateModelSettings).toHaveBeenCalledWith(
			baseSession.id,
			expect.objectContaining({ modelKey: "openai/gpt-5" }),
		);
		expect(result.current.model.modelKey).toBe("openai/gpt-5");

		act(() => result.current.actions.setDraft("Ship it"));
		await act(async () => result.current.actions.selectReasoning("high"));
		await act(async () => result.current.actions.send());
		expect(window.vetta.agentTeams.sendMessage).toHaveBeenCalledWith(
			baseSession.id,
			expect.objectContaining({
				modelKey: "openai/gpt-5",
				reasoning: "high",
			}),
		);
	});

	it("snapshots the global default into an unconfigured Team session", async () => {
		const store = createStore();
		store.set(selectedModelAtom, "openai/default");
		store.set(reasoningByModelAtom, { "openai/default": "medium" });
		const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;

		renderHook(() => useTeamChatModel(team.id), { wrapper });

		await waitFor(() =>
			expect(window.vetta.agentTeams.updateModelSettings).toHaveBeenCalledWith(baseSession.id, {
				modelKey: "openai/default",
				reasoning: "medium",
			}),
		);
	});

	it("shows context usage for the selected member runtime", async () => {
		const secondMember = team.members.find((member) => member.id !== leader.id);
		if (!secondMember) throw new Error("built-in Agent Team second member fixture is missing");
		const scopedSession: TeamSessionDocument = {
			...baseSession,
			memberRuntime: {
				[leader.id]: {
					sessionId: "leader-runtime",
					sessionPath: "C:/sessions/leader.jsonl",
					agentProfileRevision: 1,
					deliveredEventIds: [],
				},
				[secondMember.id]: {
					sessionId: "second-runtime",
					sessionPath: "C:/sessions/second.jsonl",
					agentProfileRevision: 1,
					deliveredEventIds: [],
				},
			},
		};
		vi.mocked(loadTeamChatSession).mockResolvedValue({
			document,
			snapshot: { ...baseSnapshot, session: scopedSession },
			sessions: [],
		});

		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));
		await waitFor(() => expect(streamListener).toBeTypeOf("function"));

		act(() => {
			streamListener?.({
				type: "desktop.team-context-usage",
				conversationId: scopedSession.id,
				memberId: leader.id,
				runtimeSessionId: "leader-runtime",
				contextUsage: { percent: 15, contextTokens: 15, contextWindow: 100 },
			});
		});
		expect(result.current.model.contextUsage?.percent).toBe(15);
		expect(result.current.model.contextUsagesByRuntime?.["leader-runtime"]?.percent).toBe(15);

		act(() =>
			result.current.actions.setDraft(`@${secondMember.handle} `, [
				{
					kind: "member",
					memberId: secondMember.id,
					handle: secondMember.handle,
					label: secondMember.handle,
				},
			]),
		);
		// A selected member can be idle and have no usage event yet. Keep the
		// shared ContextRing mounted with the latest known team runtime usage.
		expect(result.current.model.contextUsage?.percent).toBe(15);

		act(() => {
			streamListener?.({
				type: "desktop.team-context-usage",
				conversationId: scopedSession.id,
				memberId: secondMember.id,
				runtimeSessionId: "second-runtime",
				contextUsage: { percent: 70, contextTokens: 70, contextWindow: 100 },
			});
		});
		expect(result.current.model.contextUsage?.percent).toBe(70);
		expect(result.current.model.contextUsagesByRuntime?.["second-runtime"]?.percent).toBe(70);
	});

	it("restores each member's cached composition when reopening a team session", async () => {
		const scopedSession: TeamSessionDocument = {
			...baseSession,
			memberRuntime: {
				[leader.id]: {
					sessionId: "leader-runtime",
					sessionPath: "C:/sessions/leader.jsonl",
					agentProfileRevision: 1,
					deliveredEventIds: [],
				},
			},
		};
		const cachedReport = contextCompositionReport("cached-leader");
		localStorage.clear();
		writeCachedContextComposition("C:/sessions/leader.jsonl", cachedReport);
		vi.mocked(loadTeamChatSession).mockResolvedValue({
			document,
			snapshot: {
				...baseSnapshot,
				session: scopedSession,
				display: {
					memberConversations: [],
					contextUsages: [
						{ runtimeSessionId: "leader-runtime", percent: 20, contextWindow: 1_000 },
					],
				},
			},
			sessions: [],
		});

		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));

		expect(result.current.model.contextUsagesByRuntime?.["leader-runtime"]?.composition?.callId).toBe("cached-leader");
	});

	it("does not reload the same session when the route is canonicalized", async () => {
		const { result, rerender } = renderHook(
			({ preferredSessionId }: { preferredSessionId?: string }) =>
				useTeamChatModel(team.id, preferredSessionId),
			{ initialProps: {} },
		);
		await waitFor(() => expect(result.current.model.status).toBe("ready"));
		const loadCalls = vi.mocked(loadTeamChatSession).mock.calls.length;

		rerender({ preferredSessionId: baseSession.id });

		expect(vi.mocked(loadTeamChatSession).mock.calls.length).toBe(loadCalls);
	});

	it("continues a staged first message after the new-session route handoff", async () => {
		let releasePaint: (() => void) | undefined;
		vi.mocked(waitForCommittedPaint).mockReturnValue(
			new Promise((resolve) => {
				releasePaint = () => resolve("painted");
			}),
		);
		stageTeamSessionHandoff({
			sessionId: baseSession.id,
			document,
			requestId: "handoff-request",
			text: "send after navigation",
			memberMentions: [],
			attachments: [{ kind: "file", path: "C:/workspace/brief.md" }],
			timestamp: 10,
			executionMode: "full-access",
		});

		const { result } = renderHook(() => useTeamChatModel(team.id, baseSession.id), {
			wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
		});
		expect(result.current.model.feedItems).toEqual([
			expect.objectContaining({ kind: "user", text: "send after navigation" }),
			expect.objectContaining({ kind: "agent", phase: "pending" }),
		]);
		expect(result.current.model.workspace).toEqual({ id: `agent-team:${team.id}`, cwd: null });
		expect(result.current.model.editorEnabled).toBe(true);
		expect(createReservedTeamChatSession).not.toHaveBeenCalled();
		expect(loadTeamChatBootstrap).not.toHaveBeenCalled();
		expect(window.vetta.agentTeams.sendMessage).not.toHaveBeenCalled();

		await act(async () => releasePaint?.());
		await waitFor(() =>
			expect(window.vetta.agentTeams.sendMessage).toHaveBeenCalledWith(
				baseSession.id,
				expect.objectContaining({
					requestId: "handoff-request",
					text: "send after navigation",
					attachments: [{ kind: "file", path: "C:/workspace/brief.md" }],
				}),
			),
		);
		expect(createReservedTeamChatSession).toHaveBeenCalledWith({
			teamId: team.id,
			sessionId: baseSession.id,
			executionMode: "full-access",
			document,
		});
		expect(takeTeamSessionHandoff(baseSession.id)).toBeUndefined();
	});

	it("keeps the submitted turn through StrictMode replay and empty setup snapshots until the send settles", async () => {
		let resolveCreation: ((value: Awaited<ReturnType<typeof createReservedTeamChatSession>>) => void) | undefined;
		vi.mocked(createReservedTeamChatSession).mockReturnValue(
			new Promise((resolve) => {
				resolveCreation = resolve;
			}),
		);
		let resolveSend: ((value: DesktopTeamSessionSnapshot) => void) | undefined;
		vi.mocked(window.vetta.agentTeams.sendMessage).mockReturnValueOnce(
			new Promise((resolve) => {
				resolveSend = resolve;
			}),
		);
		const requestId = "strict-handoff-request";
		const submittedText = "keep this submitted message";
		stageTeamSessionHandoff({
			sessionId: baseSession.id,
			document,
			requestId,
			text: submittedText,
			memberMentions: [],
			attachments: [],
			timestamp: 10,
			executionMode: "full-access",
		});

		const { result } = renderHook(() => useTeamChatModel(team.id, baseSession.id), {
			wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
		});
		await waitFor(() => expect(createReservedTeamChatSession).toHaveBeenCalledTimes(1));
		const initialFeedKey = result.current.model.feedKey;
		const initialRenderKeys = result.current.model.feedItems.map((item) => item.renderKey);
		act(() => result.current.actions.setDraft("a new draft during setup"));
		expect(result.current.model.editorEnabled).toBe(true);

		await act(async () => resolveCreation?.({ document, snapshot: baseSnapshot, sessions: [] }));
		await waitFor(() => expect(window.vetta.agentTeams.sendMessage).toHaveBeenCalledTimes(1));
		expect(peekTeamSessionHandoff(baseSession.id)).toBeUndefined();
		expect(result.current.model.feedKey).toBe(initialFeedKey);
		expect(result.current.model.feedItems.map((item) => item.renderKey)).toEqual(initialRenderKeys);
		expect(result.current.model.feedItems).toEqual([
			expect.objectContaining({ kind: "user", text: submittedText }),
			expect.objectContaining({ kind: "agent", phase: "pending" }),
		]);
		expect(result.current.model.status).toBe("sending");
		expect(result.current.model.draft).toBe("a new draft during setup");

		// Main is still running the initial member turns. Setup can publish an empty
		// snapshot after the route handoff has been removed, before a user record lands.
		await waitFor(() => expect(streamListener).toBeTypeOf("function"));
		act(() => {
			streamListener?.({
				type: "session-updated",
				teamSessionId: baseSession.id,
				snapshot: baseSnapshot,
			});
			streamListener?.({
				type: "session-snapshot",
				teamSessionId: baseSession.id,
				snapshot: baseSnapshot,
				activeMessageEvents: [],
			});
			result.current.actions.setDraft("the next message");
		});
		expect(result.current.model.feedItems.map((item) => item.renderKey)).toEqual(initialRenderKeys);
		expect(result.current.model.feedItems).toEqual([
			expect.objectContaining({ kind: "user", text: submittedText }),
			expect.objectContaining({ kind: "agent", phase: "pending" }),
		]);
		expect(result.current.model.editorEnabled).toBe(true);
		expect(result.current.model.status).toBe("sending");
		expect(result.current.model.draft).toBe("the next message");
		expect(result.current.model.canSend).toBe(false);
		await act(async () => result.current.actions.send());
		expect(window.vetta.agentTeams.sendMessage).toHaveBeenCalledTimes(1);
		expect(window.vetta.agentTeams.sendMessage).toHaveBeenCalledWith(
			baseSession.id,
			expect.objectContaining({ requestId, text: submittedText }),
		);

		const finalSnapshot: DesktopTeamSessionSnapshot = {
			...baseSnapshot,
			conversationRevision: 2,
			messages: [
				{
					kind: "user",
					id: "persisted-user",
					turnId: requestId,
					author: { kind: "user", id: "local-user" },
					message: { role: "user", content: submittedText, timestamp: 10 },
					timestamp: 10,
				},
				{
					kind: "agent",
					id: "persisted-reply",
					turnId: requestId,
					author: { kind: "agent", id: leader.id },
					message: {
						...createAssistantMessage(
							{ api: "agent-team-test", provider: "agent-team-test", model: "fixture" },
							{ timestamp: 11 },
						),
						content: [{ type: "text", text: "received" }],
					},
					timestamp: 11,
				},
			],
		};
		act(() => {
			streamListener?.({
				type: "session-updated",
				teamSessionId: baseSession.id,
				snapshot: finalSnapshot,
			});
		});
		// A published member result does not release the request's cancellation scope.
		// sendMessage settles only after Main has joined all initial member turns.
		expect(result.current.model.canSend).toBe(false);
		await act(async () => resolveSend?.(finalSnapshot));
		expect(result.current.model.status).toBe("ready");
		expect(result.current.model.canSend).toBe(true);
		expect(result.current.model.draft).toBe("the next message");
		expect(result.current.model.feedItems).toEqual([
			expect.objectContaining({ kind: "user", text: submittedText }),
			expect.objectContaining({ kind: "agent", phase: "completed" }),
		]);
		vi.mocked(window.vetta.agentTeams.sendMessage).mockResolvedValue(finalSnapshot);
		await act(async () => result.current.actions.send());
		expect(window.vetta.agentTeams.sendMessage).toHaveBeenCalledTimes(2);
		expect(window.vetta.agentTeams.sendMessage).toHaveBeenLastCalledWith(
			baseSession.id,
			expect.objectContaining({ text: "the next message" }),
		);
	});

	it("aborts a team that is still streaming after the send request already resolved", async () => {
		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));
		await waitFor(() => expect(streamListener).toBeTypeOf("function"));
		act(() => result.current.actions.setDraft("dispatch the team"));
		// The leader's own turn finishes and the IPC resolves, but the members it
		// dispatched keep streaming — this is the state the stop button must still cover.
		await act(async () => result.current.actions.send());
		act(() => streamListener?.(streamEvent(1, "member still working")));
		await waitFor(() => expect(result.current.model.status).toBe("streaming"));

		await act(async () => result.current.actions.abort());
		expect(window.vetta.agentTeams.abort).toHaveBeenCalledWith(baseSession.id);
	});

	it("keeps showing a member turn that restarts after a stop", async () => {
		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));
		await waitFor(() => expect(streamListener).toBeTypeOf("function"));
		act(() => result.current.actions.setDraft("dispatch the team"));
		await act(async () => result.current.actions.send());
		act(() => streamListener?.(streamEvent(1, "first answer")));
		await waitFor(() => expect(result.current.model.status).toBe("streaming"));

		await act(async () => result.current.actions.abort());

		// The retry keeps its send in flight, so the composer stays in the waiting state
		// the user sees as "已等待 · n秒" while the member starts streaming again.
		let resolveRetry: ((value: DesktopTeamSessionSnapshot) => void) | undefined;
		vi.mocked(window.vetta.agentTeams.sendMessage).mockReturnValueOnce(
			new Promise((resolve) => {
				resolveRetry = resolve;
			}),
		);
		act(() => result.current.actions.setDraft("try again"));
		let retry: Promise<void> | undefined;
		act(() => {
			retry = result.current.actions.send();
		});
		await waitFor(() => expect(window.vetta.agentTeams.sendMessage).toHaveBeenCalledTimes(2));

		act(() => streamListener?.(streamEvent(1, "second answer")));
		await waitFor(() => expect(result.current.model.status).toBe("streaming"));
		expect(
			result.current.model.feedItems.some((item) => item.kind === "agent" && item.phase === "streaming"),
		).toBe(true);
		resolveRetry?.(baseSnapshot);
		await act(async () => {
			await retry;
		});
	});

	it("does not drop a streamed reply when the snapshot carrying it is rejected as stale", async () => {
		// The send response advances the local snapshot revisions.
		vi.mocked(window.vetta.agentTeams.sendMessage).mockResolvedValueOnce({
			...baseSnapshot,
			session: { ...baseSession, revision: 5 },
			conversationRevision: 5,
		});
		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));
		await waitFor(() => expect(streamListener).toBeTypeOf("function"));
		act(() => result.current.actions.setDraft("dispatch the team"));
		await act(async () => result.current.actions.send());

		act(() => streamListener?.(streamEvent(1, "the answer")));
		await waitFor(() => expect(result.current.model.status).toBe("streaming"));
		expect(result.current.model.feedItems.some((item) => item.kind === "agent")).toBe(true);

		// A session-updated whose revisions are behind the local ones is rejected as
		// stale — but it still reports the message as persisted. Pruning the stream on
		// a snapshot we refuse to adopt erases the reply from both places at once.
		act(() =>
			streamListener?.({
				type: "session-updated",
				teamSessionId: baseSession.id,
				snapshot: {
					...baseSnapshot,
					session: { ...baseSession, revision: 1 },
					conversationRevision: 1,
					messages: [{ id: "result" } as never],
				},
			}),
		);

		expect(result.current.model.feedItems.some((item) => item.kind === "agent")).toBe(true);
	});

	it("shows the in-flight turn from a session-snapshot even when its revisions look stale", async () => {
		vi.mocked(window.vetta.agentTeams.sendMessage).mockResolvedValueOnce({
			...baseSnapshot,
			session: { ...baseSession, revision: 5 },
			conversationRevision: 5,
		});
		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));
		await waitFor(() => expect(streamListener).toBeTypeOf("function"));
		act(() => result.current.actions.setDraft("dispatch the team"));
		await act(async () => result.current.actions.send());

		// A session-snapshot rebuilds the stream from activeMessageEvents — it is the
		// first frame of a turn already under way. Its revisions trail the ones the send
		// response just installed, but skipping it hides the running turn until some
		// later event happens to be accepted.
		act(() =>
			streamListener?.({
				type: "session-snapshot",
				teamSessionId: baseSession.id,
				snapshot: { ...baseSnapshot, session: { ...baseSession, revision: 1 }, conversationRevision: 1 },
				activeMessageEvents: [streamEvent(1, "already working")] as never,
			}),
		);

		await waitFor(() => expect(result.current.model.status).toBe("streaming"));
		expect(result.current.model.feedItems.some((item) => item.kind === "agent")).toBe(true);
	});

	it.each(["failed", "aborted"] as const)("releases a %s send without overwriting a newer draft", async (outcome) => {
		let rejectSend: ((reason: Error) => void) | undefined;
		vi.mocked(window.vetta.agentTeams.sendMessage).mockReturnValueOnce(
			new Promise((_resolve, reject) => {
				rejectSend = reject;
			}),
		);
		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));
		act(() => result.current.actions.setDraft("first message"));
		let sendPromise: Promise<void> | undefined;
		act(() => {
			sendPromise = result.current.actions.send();
		});
		act(() => result.current.actions.setDraft("edited while sending"));
		expect(result.current.model.editorEnabled).toBe(true);
		expect(result.current.model.canSend).toBe(false);
		if (outcome === "aborted") {
			await act(async () => result.current.actions.abort());
			expect(window.vetta.agentTeams.abort).toHaveBeenCalledWith(baseSession.id);
		}
		await act(async () => {
			rejectSend?.(new Error("send stopped"));
			await sendPromise;
		});
		expect(result.current.model.status).toBe(outcome === "aborted" ? "ready" : "error");
		expect(result.current.model.error).toBe(outcome === "aborted" ? undefined : "send stopped");
		expect(result.current.model.draft).toBe("edited while sending");
		expect(result.current.model.editorEnabled).toBe(true);
		expect(result.current.model.canSend).toBe(true);
		expect(result.current.model.feedItems.some((item) => item.kind === "agent" && item.phase === "pending")).toBe(false);
		await act(async () => result.current.actions.send());
		expect(window.vetta.agentTeams.sendMessage).toHaveBeenCalledTimes(2);
		expect(window.vetta.agentTeams.sendMessage).toHaveBeenLastCalledWith(
			baseSession.id,
			expect.objectContaining({ text: "edited while sending" }),
		);
	});

	it("commits the new Team shell before starting runtime-backed session creation", async () => {
		let releasePaint: (() => void) | undefined;
		vi.mocked(waitForCommittedPaint).mockReturnValue(
			new Promise((resolve) => {
				releasePaint = () => resolve("painted");
			}),
		);

		const { result } = renderHook(() => useTeamChatModel(team.id, undefined, undefined, true));

		expect(result.current.model.activeSessionId).toBeNull();
		expect(result.current.model.editorEnabled).toBe(true);
		expect(createTeamChatSession).not.toHaveBeenCalled();
		expect(loadTeamChatBootstrap).not.toHaveBeenCalled();

		await act(async () => releasePaint?.());
		await waitFor(() => expect(result.current.model.status).toBe("ready"));
		expect(createTeamChatSession).toHaveBeenCalledWith(team.id);
		expect(loadTeamChatBootstrap).toHaveBeenCalledWith(team.id);
	});

	it("shows a submitted message and leader while the new session record is still preparing", async () => {
		let resolveCreation: ((value: Awaited<ReturnType<typeof createTeamChatSession>>) => void) | undefined;
		vi.mocked(createTeamChatSession).mockReturnValue(
			new Promise((resolve) => {
				resolveCreation = resolve;
			}),
		);
		const { result } = renderHook(() => useTeamChatModel(team.id, undefined, undefined, true));
		await waitFor(() => expect(createTeamChatSession).toHaveBeenCalledWith(team.id));

		act(() => result.current.actions.setDraft("Start immediately"));
		let sendPromise: Promise<void> | undefined;
		act(() => {
			sendPromise = result.current.actions.send();
		});
		expect(result.current.model.feedItems).toEqual([
			expect.objectContaining({ kind: "user", text: "Start immediately" }),
			expect.objectContaining({ kind: "agent", authorId: team.leaderMemberId, phase: "pending" }),
		]);

		await act(async () => {
			resolveCreation?.({ document, snapshot: baseSnapshot, sessions: [] });
			await sendPromise;
		});
		expect(window.vetta.agentTeams.sendMessage).toHaveBeenCalledWith(
			baseSession.id,
			expect.objectContaining({ text: "Start immediately" }),
		);
	});
});

function contextCompositionReport(callId: string): ContextCompositionReport {
	return {
		version: 1,
		callId,
		snapshotId: `${callId}-snapshot`,
		phase: "completed",
		createdAt: 1,
		model: { provider: "test", modelId: "fixture", contextWindow: 1_000 },
		estimate: { tokens: 200, knownTokens: 200, coverage: "complete" },
		sections: [],
	};
}
