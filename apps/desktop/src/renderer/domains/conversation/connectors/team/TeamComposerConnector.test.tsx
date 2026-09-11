// @vitest-environment jsdom

import { pendingQuestionsAtom } from "@shared/store/atoms";
import { act, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InputBarModel } from "../../components/input-bar/types";
import type { TeamChatActions, TeamChatViewModel } from "./teamChatModel";
import { TeamComposerConnector } from "./TeamComposerConnector";

const captured = vi.hoisted(() => ({
	model: undefined as InputBarModel | undefined,
	insertMemberToken: vi.fn(),
	removeMemberToken: vi.fn(),
}));

Object.defineProperty(window, "vetta", {
	configurable: true,
	value: {
		config: { get: vi.fn(async () => ({})) },
	},
});

vi.mock("../../components/InputBar", () => ({
	InputBar: ({ model }: { model: InputBarModel }) => {
		captured.model = model;
		return <div data-testid="input-bar" />;
	},
}));

vi.mock("../../components/input-bar/editor/inputEditorHandle", async () => ({
	...(await vi.importActual<typeof import("../../components/input-bar/editor/inputEditorHandle")>(
		"../../components/input-bar/editor/inputEditorHandle",
	)),
	insertMemberToken: captured.insertMemberToken,
	removeMemberToken: captured.removeMemberToken,
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: { config: { get: vi.fn(async () => ({})) } },
	});
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

function model(overrides: Partial<TeamChatViewModel> = {}): TeamChatViewModel {
	return {
		feedKey: "session-1",
		title: "Team",
		status: "ready",
		draft: "Ship it",
		history: ["Previous"],
		attachments: [{ path: "C:/workspace/brief.md", name: "brief.md", kind: "file" }],
		members: [
			{ id: "member-1", kind: "agent", name: "Research", handle: "research", blueprintId: "researcher", selected: false, status: "working" },
			{ id: "member-2", kind: "agent", name: "Build", handle: "build", blueprintId: "builder", selected: false, status: "idle" },
			{ id: "member-3", kind: "agent", name: "", handle: "custom", blueprintId: "custom", selected: false, status: "idle" },
		],
		leaderMemberId: "member-1",
		feedItems: [],
		editorEnabled: true,
		canSend: true,
		workspace: { id: "team:1", cwd: "C:/workspace" },
		activeSessionId: "session-1",
		sessions: [{ id: "session-1", label: "Conversation 1" }],
		sessionActionsDisabled: false,
		modelKey: "openai/gpt-5",
		reasoning: "high",
		labels: {
			leaderRoute: "Leader",
			memberRoleFallback: "Member",
			memberRoles: { researcher: "Researcher", builder: "Builder" },
			placeholder: "Ask the team",
			attachFile: "Add file",
			attachImage: "Add image",
		},
		runtimeSessionIds: ["runtime-1"],
		executionMode: "full-access",
		contextUsage: { percent: 20, contextTokens: 20, contextWindow: 100 },
		isCompacting: false,
		...overrides,
	};
}

describe("TeamComposerConnector", () => {
	it("composes Team state and commands with the existing InputBar contract", () => {
		const viewActions = actions();
		render(<TeamComposerConnector model={model()} actions={viewActions} />);
		const inputModel = captured.model;
		expect(inputModel).toBeDefined();
		if (!inputModel) throw new Error("InputBar model was not captured");

		expect(inputModel.editor).toMatchObject({ value: "Ship it", history: ["Previous"] });
		expect(inputModel.modelSelector.updateActiveSession).toBe(false);
		expect(inputModel.editor.persistenceId).toBe("session-1");
		expect(inputModel.commands).toBeDefined();
		expect(inputModel.commands?.onOpen).toBeTypeOf("function");
		expect(inputModel.commands?.atItems).toEqual([
			expect.objectContaining({ kind: "team-member", name: "Research", insertText: "@research " }),
			expect.objectContaining({ kind: "team-member", name: "Build", insertText: "@build " }),
		expect.objectContaining({ kind: "team-member", name: "@custom", insertText: "@custom " }),
		]);
		inputModel.commands?.onAtSelect(inputModel.commands.atItems?.[0] ?? {
			kind: "team-member",
			id: "fallback",
			name: "Fallback",
			insertText: "@fallback ",
		});
		expect(captured.insertMemberToken).toHaveBeenCalledWith(
			"member-1",
			"research",
			"Research",
			expect.any(String),
			expect.stringContaining("Leader"),
			expect.objectContaining({ replaceTrigger: true }),
		);
		expect(inputModel.speechInput).toBeDefined();
		expect(inputModel.routing?.participants[0]?.avatar).toBe("./agent-team-avatars/researcher.webp");
		expect(inputModel.routing?.participants[0]?.badgeLabel).toBe("Leader");
		expect(inputModel.routing?.participants[1]?.badgeLabel).toBe("Builder");
		expect(inputModel.routing?.participants[2]?.badgeLabel).toBe("Member");
		expect(inputModel.routing?.participants[0]?.statusLabel).toBeUndefined();
		expect(inputModel.routing?.labels.trigger).toBeTypeOf("string");
		expect(inputModel.routing?.labels.selected(2)).toBeTypeOf("string");
		expect(inputModel.leadingTools[0]?.kind).toBe("execution-mode");
		expect(inputModel.trailingTools[0]?.kind).toBe("context-usage");

		act(() => {
			expect(inputModel.actions.handleEnter()).toBe(true);
			inputModel.routing?.participants[0]?.onSelect();
			inputModel.actions.removeImage("C:/workspace/brief.md");
			inputModel.modelSelector.scope?.onModelSelect("anthropic/claude", "medium");
		});

		expect(viewActions.send).toHaveBeenCalledOnce();
		expect(viewActions.send).toHaveBeenCalledWith("followUp");
		expect(captured.insertMemberToken).toHaveBeenLastCalledWith(
			"member-1",
			"research",
			"Research",
			expect.any(String),
			"@research",
		);
		expect(viewActions.removeAttachment).toHaveBeenCalledWith("C:/workspace/brief.md");
		expect(viewActions.selectModel).toHaveBeenCalledWith("anthropic/claude", "medium");
	});

	it("maps Ctrl+Enter to steer while keeping Enter as followUp", () => {
		const viewActions = actions();
		render(<TeamComposerConnector model={model()} actions={viewActions} />);
		const inputModel = captured.model;
		if (!inputModel) throw new Error("InputBar model was not captured");
		act(() => {
			inputModel.actions.handleEnter(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
		});
		expect(viewActions.send).toHaveBeenCalledWith("steer");
	});

	it("does not submit the same Ctrl+Enter KeyboardEvent twice", () => {
		const viewActions = actions();
		render(<TeamComposerConnector model={model()} actions={viewActions} />);
		const inputModel = captured.model;
		if (!inputModel) throw new Error("InputBar model was not captured");
		const event = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true });
		act(() => {
			inputModel.actions.handleEnter(event);
			inputModel.actions.handleEnter(event);
		});
		expect(viewActions.send).toHaveBeenCalledOnce();
		expect(viewActions.send).toHaveBeenCalledWith("steer");
	});

	it("surfaces a pending ask_user_question owned by one of the team member runtimes", () => {
		const store = createStore();
		store.set(pendingQuestionsAtom, {
			"runtime-1": {
				requestId: "question-request",
				sessionId: "runtime-1",
				questions: [
					{
						question: "Which approach?",
						header: "Approach",
						multiSelect: false,
						options: [
							{ label: "A", description: "First" },
							{ label: "B", description: "Second" },
						],
					},
				],
			},
		});
		const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
		render(<TeamComposerConnector model={model()} actions={actions()} />, { wrapper });

		expect(captured.model?.pendingQuestion).toMatchObject({
			requestId: "question-request",
			sessionId: "runtime-1",
		});
	});

	it("reports command panel expansion so the page can fade the hero away", () => {
		const onExpandedChange = vi.fn();
		render(
			<TeamComposerConnector model={model()} actions={actions()} onExpandedChange={onExpandedChange} />,
		);

		act(() => captured.model?.commands?.onTriggerChange({ kind: "slash", query: "", length: 1 }));
		expect(onExpandedChange).toHaveBeenLastCalledWith(true);

		act(() => captured.model?.commands?.onTriggerChange(null));
		expect(onExpandedChange).toHaveBeenLastCalledWith(false);
	});

	it("projects a scoped member mention back into an editor token", () => {
		render(
			<TeamComposerConnector
				model={model({
					draft: "@research review this",
					draftMemberMentions: [
						{ participantId: "member-1", handle: "research", start: 0, end: 9 },
					],
				})}
				actions={actions()}
			/>,
		);

		expect(captured.model?.editor.segments).toEqual([
			expect.objectContaining({ kind: "member", memberId: "member-1", handle: "research" }),
			{ kind: "text", text: " review this" },
		]);
	});
});
