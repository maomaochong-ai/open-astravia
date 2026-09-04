// @vitest-environment jsdom

import {
	createInitialAgentTeamDocument,
	type TeamSessionDocument,
	type TeamSessionSnapshot,
} from "@vetta/agent-team";
import type { DesktopTeamSessionStreamEvent, DesktopTeamSessionSnapshot } from "@preload/api-types/team-conversation-display";
import { createAssistantMessage } from "@vetta/ai";
import { reasoningByModelAtom, selectedModelAtom } from "@shared/store/atoms";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTeamChatModel } from "./useTeamChatModel";
import { loadTeamChatSession } from "./team-chat-session-service";

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
	createTeamChatSession: vi.fn(),
}));

const document = createInitialAgentTeamDocument();
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
		expect(result.current.model.feedItems).toEqual([
			expect.objectContaining({
				kind: "agent",
				phase: "completed",
				blocks: [expect.objectContaining({ type: "text", text: "partial answer" })],
			}),
		]);
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
			streamListener?.({
				type: "desktop.team-context-usage",
				conversationId: scopedSession.id,
				memberId: secondMember.id,
				runtimeSessionId: "second-runtime",
				contextUsage: { percent: 70, contextTokens: 70, contextWindow: 100 },
			});
		});
		expect(result.current.model.contextUsage?.percent).toBe(15);

		act(() => result.current.actions.toggleMember(secondMember.id));
		expect(result.current.model.contextUsage?.percent).toBe(70);
	});
});
