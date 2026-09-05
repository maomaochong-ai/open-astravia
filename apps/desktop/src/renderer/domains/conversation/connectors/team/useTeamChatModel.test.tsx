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
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTeamChatModel } from "./useTeamChatModel";
import {
	createTeamChatSession,
	loadTeamChatBootstrap,
	loadTeamChatSession,
} from "./team-chat-session-service";
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

function streamEvent(sequence: number, delta: string): DesktopTeamSessionStreamEvent {
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
		turnId: "request",
		author: { kind: "agent", id: team.leaderMemberId },
		sequence,
		timestamp: sequence,
		event: { type: "text_delta", contentIndex: 0, delta, partial },
	};
}

describe("useTeamChatModel streaming flow", () => {
	let streamListener: ((event: DesktopTeamSessionStreamEvent) => void) | undefined;

	beforeEach(() => {
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

		act(() => result.current.actions.toggleMember(secondMember.id));
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
