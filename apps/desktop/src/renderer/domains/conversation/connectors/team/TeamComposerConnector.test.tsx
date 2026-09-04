// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InputBarModel } from "../../components/input-bar/types";
import type { TeamChatActions, TeamChatViewModel } from "./teamChatModel";
import { TeamComposerConnector } from "./TeamComposerConnector";

const captured = vi.hoisted(() => ({ model: undefined as InputBarModel | undefined }));

vi.mock("../../components/InputBar", () => ({
	InputBar: ({ model }: { model: InputBarModel }) => {
		captured.model = model;
		return <div data-testid="input-bar" />;
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

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
	};
}

function model(): TeamChatViewModel {
	return {
		feedKey: "session-1",
		title: "Team",
		status: "ready",
		draft: "Ship it",
		history: ["Previous"],
		attachments: [{ path: "C:/workspace/brief.md", name: "brief.md", kind: "file" }],
		members: [{ id: "member-1", kind: "agent", name: "Research", handle: "research", blueprintId: "researcher", selected: false, status: "idle" }],
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
			placeholder: "Ask the team",
			attachFile: "Add file",
			attachImage: "Add image",
		},
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
		expect(inputModel.speechInput).toBeDefined();
		expect(inputModel.routing?.leaderSelected).toBe(true);

		act(() => {
			expect(inputModel.actions.handleEnter()).toBe(true);
			inputModel.routing?.participants[0]?.onSelect();
			inputModel.actions.removeImage("C:/workspace/brief.md");
			inputModel.modelSelector.scope?.onModelSelect("anthropic/claude", "medium");
		});

		expect(viewActions.send).toHaveBeenCalledOnce();
		expect(viewActions.toggleMember).toHaveBeenCalledWith("member-1");
		expect(viewActions.removeAttachment).toHaveBeenCalledWith("C:/workspace/brief.md");
		expect(viewActions.selectModel).toHaveBeenCalledWith("anthropic/claude", "medium");
	});
});
