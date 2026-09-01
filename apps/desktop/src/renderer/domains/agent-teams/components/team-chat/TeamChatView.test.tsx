// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamChatActions, TeamChatViewModel } from "./teamChatModel";
import { TeamChatView } from "./TeamChatView";

vi.mock("@vetta/theme-ui/chat", () => ({
	ConversationComposerView: ({
		regions,
	}: {
		regions: { routing?: ReactNode; editor: ReactNode; toolbar: ReactNode };
	}) => (
		<div>
			{regions.routing}
			{regions.editor}
			{regions.toolbar}
		</div>
	),
	SendButton: ({
		isStreaming,
		onSend,
		onAbort,
	}: {
		isStreaming: boolean;
		onSend: () => void;
		onAbort: () => void;
	}) => (
		<button type="button" onClick={isStreaming ? onAbort : onSend}>
			{isStreaming ? "stop" : "send"}
		</button>
	),
}));
vi.mock("./TeamMessageFeed", () => ({ TeamMessageFeed: () => <div>timeline</div> }));
vi.mock("./TeamComposer", () => ({ TeamComposer: () => <div>members</div> }));

afterEach(cleanup);

const markdown = {
	theme: "light" as const,
	labels: { copy: "Copy", copied: "Copied" },
	getFileIconClass: () => "icon",
	onOpenFile: vi.fn(),
	onOpenUrl: vi.fn(),
};
const labels = {
	loading: "Loading",
	readyTitle: "Ready",
	readyDescription: "Describe the goal",
	leaderRoute: "Leader",
	placeholder: "Ask the team",
	hint: "Use @",
	send: "Send",
	stop: "Stop",
	sending: "Working",
	failed: "Failed",
	retry: "Retry",
};

function model(status: TeamChatViewModel["status"]): TeamChatViewModel {
	return {
		title: "Team",
		status,
		draft: "ship it",
		members: [],
		timelineItems: [],
		markdown,
		editorEnabled: true,
		canSend: status === "ready",
		labels,
	};
}

function actions(): TeamChatActions {
	return {
		setDraft: vi.fn(),
		selectLeader: vi.fn(),
		toggleMember: vi.fn(),
		send: vi.fn(async () => undefined),
		abort: vi.fn(async () => undefined),
	};
}

describe("TeamChatView composer interaction", () => {
	it("submits with Enter and preserves Shift+Enter for a newline", () => {
		const viewActions = actions();
		render(<TeamChatView model={model("ready")} actions={viewActions} />);
		const editor = screen.getByRole("textbox", { name: "Ask the team" });
		fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
		expect(viewActions.send).not.toHaveBeenCalled();
		fireEvent.keyDown(editor, { key: "Enter" });
		expect(viewActions.send).toHaveBeenCalledOnce();
	});

	it("routes the shared streaming button to abort", () => {
		const viewActions = actions();
		render(<TeamChatView model={model("streaming")} actions={viewActions} />);
		fireEvent.click(screen.getByRole("button", { name: "stop" }));
		expect(viewActions.abort).toHaveBeenCalledOnce();
	});
});
