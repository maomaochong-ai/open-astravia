// @vitest-environment jsdom

import {
	createInitialAgentTeamDocument,
	type TeamSessionDocument,
	type TeamSessionStreamEvent,
} from "@vetta/agent-team";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTeamChatSession } from "../services/team-chat-session-service";
import { useTeamChatModel } from "./useTeamChatModel";

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
vi.mock("../services/team-chat-session-service", () => ({
	loadTeamChatSession: vi.fn(),
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

describe("useTeamChatModel streaming flow", () => {
	let streamListener: ((event: TeamSessionStreamEvent) => void) | undefined;

	beforeEach(() => {
		streamListener = undefined;
		vi.mocked(loadTeamChatSession).mockResolvedValue({ document, session: baseSession });
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				agentTeams: {
					subscribe: vi.fn(
						async (_sessionId: string, listener: (event: TeamSessionStreamEvent) => void) => {
						streamListener = listener;
						return () => undefined;
						},
					),
					sendMessage: vi.fn(async () => baseSession),
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
			streamListener?.({
				type: "member-start",
				teamSessionId: baseSession.id,
				memberId: leader.id,
				requestId: "request",
				turnId: "turn",
				seq: 0,
				timestamp: 2,
			});
			streamListener?.({
				type: "member-delta",
				teamSessionId: baseSession.id,
				memberId: leader.id,
				requestId: "request",
				turnId: "turn",
				seq: 1,
				delta: "partial ",
				timestamp: 3,
			});
			streamListener?.({
				type: "member-delta",
				teamSessionId: baseSession.id,
				memberId: leader.id,
				requestId: "request",
				turnId: "turn",
				seq: 2,
				delta: "answer",
				timestamp: 4,
			});
		});

		expect(result.current.model.status).toBe("streaming");
		expect(result.current.model.timelineItems).toEqual([
			expect.objectContaining({
				kind: "message",
				message: expect.objectContaining({
					kind: "agent",
					phase: "streaming",
					blocks: [expect.objectContaining({ type: "text", text: "partial answer" })],
				}),
			}),
		]);

		const finalSession: TeamSessionDocument = {
			...baseSession,
			revision: 1,
			updatedAt: 5,
			events: [
				{
					type: "member-result",
					id: "result",
					requestId: "request",
					memberId: leader.id,
					sourceTurnId: "turn",
					text: "partial answer",
					timestamp: 5,
				},
			],
		};
		act(() => {
			streamListener?.({
				type: "session-updated",
				teamSessionId: baseSession.id,
				session: finalSession,
				revision: finalSession.revision,
			});
			streamListener?.({
				type: "member-end",
				teamSessionId: baseSession.id,
				memberId: leader.id,
				requestId: "request",
				turnId: "turn",
				seq: 3,
				phase: "final",
				timestamp: 5,
			});
		});

		expect(result.current.model.status).toBe("ready");
		expect(result.current.model.timelineItems).toEqual([
			expect.objectContaining({
				kind: "message",
				message: expect.objectContaining({
					kind: "agent",
					phase: "completed",
					blocks: [expect.objectContaining({ type: "text", text: "partial answer" })],
				}),
			}),
		]);
	});

	it("submits attachments as structured request data instead of prompt markup", async () => {
		const { result } = renderHook(() => useTeamChatModel(team.id));
		await waitFor(() => expect(result.current.model.status).toBe("ready"));

		await act(async () => result.current.actions.selectFiles());
		expect(result.current.model.canSend).toBe(true);
		await act(async () => result.current.actions.send());

		expect(window.vetta.agentTeams.sendMessage).toHaveBeenCalledWith(
			baseSession.id,
			expect.objectContaining({
				text: "",
				attachments: [{ kind: "file", path: "C:/workspace/brief.md" }],
			}),
		);
	});
});
