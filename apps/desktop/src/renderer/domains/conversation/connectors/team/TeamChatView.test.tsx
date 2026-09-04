// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamChatActions, TeamChatViewModel } from "./teamChatModel";
import { TeamChatView } from "./TeamChatView";

const captured = vi.hoisted(() => ({ view: vi.fn() }));

vi.mock("../../components/chat-view/DefaultChatView", () => ({
	DefaultChatView: (props: unknown) => {
		captured.view(props);
		return <div data-testid="default-chat-view" />;
	},
}));
vi.mock("./TeamComposerConnector", () => ({
	TeamComposerConnector: () => <div data-testid="team-input-bar" />,
}));

afterEach(() => {
	cleanup();
	captured.view.mockReset();
});

function actions(): TeamChatActions {
	return {
		setDraft: vi.fn(),
		selectLeader: vi.fn(),
		toggleMember: vi.fn(),
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
		members: [{ id: "member-1", kind: "agent", name: "Researcher", handle: "researcher", blueprintId: "researcher", selected: false, status: "working" }],
		feedItems: [{ id: "message-1", turnId: "turn-1", authorId: "member-1", kind: "agent", role: "assistant", phase: "streaming", blocks: [] }],
		editorEnabled: true,
		canSend: false,
		workspace: null,
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
		render(<TeamChatView model={viewModel} actions={actions()} />);

		expect(screen.getByTestId("default-chat-view")).toBeTruthy();
		expect(captured.view).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [expect.objectContaining({ id: "message-1", kind: "agent", authorId: "member-1" })],
				participants: viewModel.members,
				messageContext: expect.objectContaining({ inheritActiveSession: false, showRuntimeFooter: false }),
				children: expect.anything(),
			}),
		);
	});

	it("scopes streaming state and removes the composer in a member view", () => {
		const viewModel = {
			...model(),
			memberViewId: "member-1",
			status: "streaming" as const,
			feedItems: [{ ...model().feedItems[0]!, phase: "completed" as const }],
		};
		render(<TeamChatView model={viewModel} actions={actions()} />);

		expect(captured.view).toHaveBeenCalledWith(
			expect.objectContaining({
				isStreaming: false,
				children: null,
			}),
		);
	});
});
