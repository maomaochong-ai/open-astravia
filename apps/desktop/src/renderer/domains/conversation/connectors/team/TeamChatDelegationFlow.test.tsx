// @vitest-environment jsdom

import type {
	DesktopTeamSessionSnapshot,
	DesktopTeamSessionStreamEvent,
} from "@preload/api-types/team-conversation-display";
import type { ChatConversationItem } from "@shared/store/atoms";
import { createAssistantMessage, type AssistantMessage } from "@vetta/ai";
import { createAgentTeamFixture, type TeamSessionDocument } from "@vetta/agent-team";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamChatView } from "./TeamChatView";
import {
	createReservedTeamChatSession,
	createTeamChatSession,
	loadTeamChatBootstrap,
	loadTeamChatSession,
} from "./team-chat-session-service";
import { useTeamChatModel } from "./useTeamChatModel";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		i18n: { language: "zh", resolvedLanguage: "zh" },
		t: (key: string, values?: Record<string, unknown>) => {
			const labels: Record<string, string> = {
				"chat.memberActivity.waiting": "等待开始",
				"chat.memberActivity.thinking": "正在思考",
				"chat.memberActivity.processing": "正在处理",
				"chat.memberActivity.processingTool": "正在调用工具",
				"chat.memberActivity.waitingReply": "等待回复",
				"chat.memberActivity.failed": "处理失败",
				"chat.memberActivity.cancelled": "已取消",
				"chat.memberActivity.completed": "已完成",
			};
			if (key === "chat.delegation") return `${values?.from} -> ${values?.to}`;
			if (key === "chat.memberActivity.openSession") return `打开 ${values?.name} 的成员会话`;
			if (key === "messageList.streamingPhrases") return [];
			return labels[key] ?? key;
		},
	}),
}));

vi.mock("@shared/hooks/useRendererMarkdownModel", () => ({
	useRendererMarkdownModel: () => ({
		theme: "light",
		labels: { copy: "Copy", copied: "Copied" },
		getFileIconClass: () => "icon",
		onOpenFile: vi.fn(),
		onOpenUrl: vi.fn(),
	}),
}));

vi.mock("@shared/lib/committed-paint", () => ({
	waitForCommittedPaint: vi.fn(async () => "painted"),
}));

vi.mock("./team-chat-session-service", () => ({
	loadTeamChatSession: vi.fn(),
	loadTeamChatBootstrap: vi.fn(),
	createTeamChatSession: vi.fn(),
	createReservedTeamChatSession: vi.fn(),
}));

vi.mock("./TeamMemberRoster", () => ({
	TeamMemberRoster: () => <div data-testid="team-member-roster" />,
}));

vi.mock("./TeamComposerConnector", () => ({
	TeamComposerConnector: ({
		model,
		actions,
	}: {
		model: { readonly draft: string; readonly canSend: boolean };
		actions: { readonly setDraft: (value: string) => void; readonly send: () => Promise<void> };
	}) => (
		<div>
			<input
				aria-label="团队任务"
				value={model.draft}
				onChange={(event) => actions.setDraft(event.currentTarget.value)}
			/>
			<button type="button" disabled={!model.canSend} onClick={() => void actions.send()}>
				发送
			</button>
		</div>
	),
}));

// This regression is about assistant/delegation rendering. Keep the unrelated
// editable user-message surface at its external component boundary.
vi.mock("../../components/message-list/UserMessage", () => ({
	UserMessage: ({ message }: { message: Extract<ChatConversationItem, { kind: "user" }> }) => (
		<div data-testid="user-message">{message.text}</div>
	),
}));

vi.mock("../../components/MessageCardsHost", () => ({
	MessageCardsHost: () => null,
}));

vi.mock("../../components/chat-view/DefaultChatView", async () => {
	const { MessageItem } = await import("../../components/message-list/MessageItem");
	return {
		DefaultChatView: ({
			children,
			messages,
			isStreaming,
			participants = [],
			pendingLabel,
			onTeamMemberOpen,
		}: {
			readonly children: ReactNode;
			readonly messages: ChatConversationItem[];
			readonly isStreaming: boolean;
			readonly participants?: readonly {
				readonly id: string;
				readonly kind: "agent";
				readonly name: string;
				readonly avatar?: string;
				readonly blueprintId: string;
			}[];
			readonly pendingLabel?: string;
			readonly onTeamMemberOpen?: (memberId: string) => void;
		}) => (
			<div>
				<div data-testid="message-list">
					{messages.map((message, index) => (
						<div key={message.renderKey ?? message.id} data-entry-id={message.entryId ?? message.id}>
							<MessageItem
								message={message}
								isTailMessage={index === messages.length - 1}
								isStreaming={isStreaming}
								participant={
									message.kind === "agent"
										? participants.find((participant) => participant.id === message.authorId)
										: undefined
								}
								pendingLabel={message.kind === "agent" && message.phase === "pending" ? pendingLabel : undefined}
								onTeamMemberOpen={onTeamMemberOpen}
							/>
						</div>
					))}
				</div>
				{children}
			</div>
		),
	};
});

const document = createAgentTeamFixture();
const team = document.teams[0];
if (!team) throw new Error("built-in Agent Team fixture is missing");
const leader = team.members.find((member) => member.id === team.leaderMemberId);
const architect = team.members.find((member) => member.handle === "architect");
if (!leader || !architect) throw new Error("Dev Team fixture is incomplete");

const session: TeamSessionDocument = {
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

const emptySnapshot: DesktopTeamSessionSnapshot = {
	session,
	conversationRevision: 0,
	messages: [],
	activities: [],
};

function assistantMessage(
	text: string,
	timestamp: number,
	toolCall?: { readonly id: string; readonly name: string; readonly arguments: Record<string, unknown> },
): AssistantMessage {
	const content: AssistantMessage["content"] = [];
	if (text) content.push({ type: "text", text });
	if (toolCall) {
		content.push({ type: "toolCall", id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments });
	}
	return {
		...createAssistantMessage(
			{ api: "agent-team-test", provider: "agent-team-test", model: "fixture" },
			{ timestamp },
		),
		content,
	};
}

function TeamFlow(): JSX.Element {
	const { model, actions } = useTeamChatModel(team.id);
	return (
		<TeamChatView
			model={model}
			actions={actions}
			onOpenMember={vi.fn()}
			onBackToTeam={vi.fn()}
			onOpenSettings={vi.fn()}
		/>
	);
}

function assistantRows(): HTMLElement[] {
	return Array.from(screen.getByTestId("message-list").querySelectorAll<HTMLElement>("[data-entry-id]")).filter(
		(row) => row.textContent?.includes("Master"),
	);
}

describe("Team delegation message-to-UI flow", () => {
	let streamListener: ((event: DesktopTeamSessionStreamEvent) => void) | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		streamListener = undefined;
		vi.mocked(loadTeamChatSession).mockResolvedValue({
			document,
			snapshot: emptySnapshot,
			sessions: [],
		});
		vi.mocked(loadTeamChatBootstrap).mockResolvedValue({ document, sessions: [] });
		vi.mocked(createTeamChatSession).mockResolvedValue({ document, snapshot: emptySnapshot, sessions: [] });
		vi.mocked(createReservedTeamChatSession).mockResolvedValue({ document, snapshot: emptySnapshot, sessions: [] });
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
					sendMessage: vi.fn(async () => emptySnapshot),
					updateModelSettings: vi.fn(async () => emptySnapshot),
					setExecutionMode: vi.fn(async () => emptySnapshot),
					abort: vi.fn(),
				},
				dialog: {
					selectFiles: vi.fn(async () => []),
					selectImages: vi.fn(async () => []),
				},
				skills: { list: vi.fn(async () => []) },
				abilities: { listOpenMarketplaces: vi.fn(async () => ({ abilities: [] })) },
				session: { getAgentModes: vi.fn(async () => []) },
			},
		});
	});

	it("renders one leader turn while delegation moves from dispatch through member completion to final summary", async () => {
		let resolveSend: ((snapshot: DesktopTeamSessionSnapshot) => void) | undefined;
		vi.mocked(window.vetta.agentTeams.sendMessage).mockReturnValueOnce(
			new Promise((resolve) => {
				resolveSend = resolve;
			}),
		);
		render(<TeamFlow />);
		await waitFor(() => expect(streamListener).toBeTypeOf("function"));

		fireEvent.change(screen.getByRole("textbox", { name: "团队任务" }), {
			target: { value: "实现并验证团队会话" },
		});
		fireEvent.click(screen.getByRole("button", { name: "发送" }));
		await waitFor(() => expect(window.vetta.agentTeams.sendMessage).toHaveBeenCalledTimes(1));
		expect(screen.getByTestId("user-message").textContent).toBe("实现并验证团队会话");
		expect(assistantRows()).toHaveLength(1);
		const requestId = vi.mocked(window.vetta.agentTeams.sendMessage).mock.calls[0]?.[1].requestId;
		if (!requestId) throw new Error("send request id is missing");

		const delegateCall = {
			id: "delegate-call",
			name: "team_delegate_task",
			arguments: { memberId: architect.id, objective: "设计实现方案", description: "委派架构设计" },
		};
		const streamedLeaderMessage = assistantMessage("规划开发方案", 2, delegateCall);
		act(() => {
			streamListener?.({
				type: "conversation.agent-message-event",
				conversationId: session.id,
				messageId: "leader-live-step",
				turnId: requestId,
				author: { kind: "agent", id: leader.id },
				sequence: 1,
				timestamp: 2,
				event: {
					type: "text_delta",
					contentIndex: 0,
					delta: "规划开发方案",
					partial: streamedLeaderMessage,
				},
			});
		});

		const persistedLeaderMessage = assistantMessage("规划开发方案与设计架构", 3, delegateCall);
		const dispatchSnapshot: DesktopTeamSessionSnapshot = {
			session: { ...session, revision: 1 },
			conversationRevision: 1,
			messages: [
				{
					kind: "user",
					id: "persisted-user",
					turnId: requestId,
					author: { kind: "user", id: "local-user" },
					message: { role: "user", content: "实现并验证团队会话", timestamp: 1 },
					timestamp: 1,
				},
				{
					kind: "agent",
					id: "leader-public-step",
					turnId: requestId,
					author: { kind: "agent", id: leader.id },
					message: { ...persistedLeaderMessage, stopReason: "toolUse" },
					timestamp: 3,
				},
			],
			activities: [
				{
					kind: "delegation",
					id: "delegate-architect",
					requestId: "architect-turn",
					originToolCallId: delegateCall.id,
					sourceMemberId: leader.id,
					targetMemberId: architect.id,
					objective: "设计实现方案",
					state: "queued",
					timestamp: 3,
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
								entryId: "leader-runtime-prompt",
								message: { role: "user", content: "private execution input", timestamp: 1 },
							},
							{
								type: "message",
								entryId: "leader-runtime-step",
								message: persistedLeaderMessage,
							},
						],
					},
				],
			},
		};
		act(() => {
			streamListener?.({ type: "session-updated", teamSessionId: session.id, snapshot: dispatchSnapshot });
		});

		await waitFor(() => expect(screen.getAllByTestId("team-member-reply-card")).toHaveLength(1));
		expect(assistantRows()).toHaveLength(1);
		expect(screen.getAllByText("委派架构设计")).toHaveLength(1);
		expect(within(screen.getByTestId("team-member-reply-card")).getByText("Architect")).toBeTruthy();
		expect(within(screen.getByTestId("team-member-reply-card")).getByText("等待开始")).toBeTruthy();

		const architectMessage = assistantMessage("架构方案已完成", 4);
		act(() => {
			streamListener?.({
				type: "conversation.agent-message-event",
				conversationId: session.id,
				messageId: "architect-live-step",
				turnId: "architect-turn",
				author: { kind: "agent", id: architect.id },
				sequence: 1,
				timestamp: 4,
				event: {
					type: "text_delta",
					contentIndex: 0,
					delta: "架构方案已完成",
					partial: architectMessage,
				},
			});
			streamListener?.({
				type: "session-updated",
				teamSessionId: session.id,
				snapshot: {
					...dispatchSnapshot,
					session: { ...session, revision: 2 },
					conversationRevision: 2,
					activities: [{ ...dispatchSnapshot.activities[0]!, state: "running" }],
				},
			});
		});

		await waitFor(() =>
			expect(within(screen.getByTestId("team-member-reply-card")).getByText("正在处理")).toBeTruthy(),
		);
		expect(assistantRows()).toHaveLength(1);
		expect(screen.getAllByTestId("team-member-reply-card")).toHaveLength(1);

		const finalText = "已完成架构设计并汇总实现建议";
		const finalSnapshot: DesktopTeamSessionSnapshot = {
			...dispatchSnapshot,
			session: { ...session, revision: 3 },
			conversationRevision: 3,
			messages: [
				...dispatchSnapshot.messages,
				{
					kind: "agent",
					id: "architect-result",
					turnId: "architect-turn",
					author: { kind: "agent", id: architect.id },
					message: architectMessage,
					timestamp: 4,
				},
				{
					kind: "agent",
					id: "leader-final-step",
					turnId: requestId,
					author: { kind: "agent", id: leader.id },
					message: assistantMessage(finalText, 5),
					timestamp: 5,
				},
			],
			activities: [{ ...dispatchSnapshot.activities[0]!, state: "completed", sourceTurnId: "architect-turn" }],
			display: { memberConversations: [] },
		};
		act(() => {
			streamListener?.({ type: "session-updated", teamSessionId: session.id, snapshot: finalSnapshot });
			streamListener?.({
				type: "conversation.agent-message-discard",
				conversationId: session.id,
				messageId: "leader-live-step",
				turnId: requestId,
				author: { kind: "agent", id: leader.id },
				sequence: 2,
				reason: "completed",
				timestamp: 5,
			});
		});
		await act(async () => resolveSend?.(finalSnapshot));

		await waitFor(() => expect(screen.getByText(finalText)).toBeTruthy());
		expect(assistantRows()).toHaveLength(1);
		expect(screen.getAllByText("委派架构设计")).toHaveLength(1);
		expect(screen.getAllByTestId("team-member-reply-card")).toHaveLength(1);
		expect(within(screen.getByTestId("team-member-reply-card")).getByText("已完成")).toBeTruthy();
	});
});
