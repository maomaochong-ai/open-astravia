// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { TeamChatActions, TeamChatViewModel } from "./teamChatModel";
import { TeamChatView } from "./TeamChatView";

const captured = vi.hoisted(() => ({ view: vi.fn(), feed: vi.fn(), composer: vi.fn() }));

vi.mock("../../components/chat-view/DefaultChatView", () => ({
	DefaultChatView: (props: { children: ReactNode }) => {
		captured.view(props);
		return <div data-testid="default-chat-view">{props.children}</div>;
	},
	ChatComposer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ChatError: ({ children }: { children?: ReactNode }) => (children ? <div role="alert">{children}</div> : null),
}));
vi.mock("../../components/MessageList", () => ({
	MessageList: (props: unknown) => {
		captured.feed(props);
		return <div data-testid="message-list" />;
	},
}));
vi.mock("./TeamComposerConnector", () => ({
	TeamComposerConnector: (props: unknown) => {
		captured.composer(props);
		return <div data-testid="team-input-bar" />;
	},
}));

afterEach(() => {
	cleanup();
	captured.view.mockReset();
	captured.feed.mockReset();
	captured.composer.mockReset();
});

function actions(): TeamChatActions {
	return {
		setDraft: vi.fn(),
		selectFiles: vi.fn(async () => undefined),
		selectImages: vi.fn(async () => undefined),
		removeAttachment: vi.fn(),
		addAttachments: vi.fn(),
		send: vi.fn(async () => undefined),
		abort: vi.fn(async () => undefined),
		createSession: vi.fn(async () => undefined),
		openSession: vi.fn(async () => undefined),
		selectModel: vi.fn(async () => undefined),
		selectReasoning: vi.fn(async () => undefined),
		setExecutionMode: vi.fn(async () => undefined),
	};
}

function model(): TeamChatViewModel {
	return {
		feedKey: "team-session",
		title: "Team",
		status: "streaming",
		draft: "",
		history: [],
		attachments: [],
		members: [
			{
				id: "member-1",
				kind: "agent",
				name: "Researcher",
				handle: "researcher",
				blueprintId: "researcher",
				selected: false,
				status: "working",
			},
		],
		feedItems: [
			{
				id: "message-1",
				turnId: "turn-1",
				authorId: "member-1",
				kind: "agent",
				role: "assistant",
				phase: "streaming",
				blocks: [],
			},
		],
		pendingLabel: "Loading team",
		editorEnabled: true,
		canSend: false,
		workspace: null,
		pluginScenario: "conversation",
		activeSessionId: "team-session",
		sessions: [{ id: "team-session", label: "Conversation 1" }],
		sessionActionsDisabled: false,
		modelKey: "openai/gpt-5",
		runtimeSessionIds: [],
		executionMode: "full-access",
		contextUsage: null,
		isCompacting: false,
		labels: {
			leaderRoute: "Leader",
			memberRoleFallback: "Member",
			placeholder: "Ask the team",
			attachFile: "Add file",
			attachImage: "Add image",
		},
	};
}

describe("TeamChatView shared conversation UI", () => {
	it("adapts Team state into the existing DefaultChatView", () => {
		const viewModel = model();
		const onOpenMember = vi.fn();
		render(
			<TeamChatView
				model={viewModel}
				actions={actions()}
				onOpenMember={onOpenMember}
				onBackToTeam={vi.fn()}
				onOpenSettings={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("default-chat-view")).toBeTruthy();
		expect(captured.feed).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [expect.objectContaining({ id: "message-1", kind: "agent", authorId: "member-1" })],
				participants: viewModel.members,
				pendingLabel: "Loading team",
				onTeamMemberOpen: onOpenMember,
			}),
		);
		expect(captured.view.mock.calls[0]?.[0].messages).toBe(viewModel.feedItems);
		expect(captured.feed.mock.calls[0]?.[0].messages).toBe(viewModel.feedItems);
	});

	it("keeps feed and roster work isolated when only the composer draft changes", () => {
		const viewModel = model();
		const viewActions = actions();
		const onOpenMember = vi.fn();
		const onBackToTeam = vi.fn();
		const onOpenSettings = vi.fn();
		const { rerender } = render(
			<TeamChatView
				model={viewModel}
				actions={viewActions}
				onOpenMember={onOpenMember}
				onBackToTeam={onBackToTeam}
				onOpenSettings={onOpenSettings}
			/>,
		);

		rerender(
			<TeamChatView
				model={{ ...viewModel, draft: "next question" }}
				actions={viewActions}
				onOpenMember={onOpenMember}
				onBackToTeam={onBackToTeam}
				onOpenSettings={onOpenSettings}
			/>,
		);

		expect(captured.feed).toHaveBeenCalledTimes(1);
		expect(captured.composer).toHaveBeenCalledTimes(2);
	});

	// A Team session drives the ordinary activity panel: plugin tabs stay enabled and the
	// scenario travels with the view model, because Team never sets the global scenario atom.
	it("hands the activity panel the team workspace and its own plugin scenario", () => {
		const viewModel = {
			...model(),
			workspace: { id: "agent-team:ws", cwd: "/tmp/team", runtimeIds: ["member-runtime"] },
			pluginScenario: "project" as const,
		};
		render(
			<TeamChatView
				model={viewModel}
				actions={actions()}
				onOpenMember={vi.fn()}
				onBackToTeam={vi.fn()}
				onOpenSettings={vi.fn()}
			/>,
		);

		expect(captured.view).toHaveBeenCalledWith(
			expect.objectContaining({
				workspace: viewModel.workspace,
				activity: { pluginScenario: "project" },
			}),
		);
		expect(captured.feed).toHaveBeenCalledWith(
			expect.objectContaining({ workspace: viewModel.workspace }),
		);
	});

	it("scopes streaming state and removes the composer in a member view", () => {
		const viewModel = {
			...model(),
			memberViewId: "member-1",
			status: "streaming" as const,
			feedItems: [{ ...model().feedItems[0]!, phase: "completed" as const }],
		};
		render(
			<TeamChatView
				model={viewModel}
				actions={actions()}
				onOpenMember={vi.fn()}
				onBackToTeam={vi.fn()}
				onOpenSettings={vi.fn()}
			/>,
		);

		expect(captured.feed).toHaveBeenCalledWith(
			expect.objectContaining({
				isStreaming: false,
			}),
		);
		expect(screen.queryByTestId("team-input-bar")).toBeNull();
	});
});
