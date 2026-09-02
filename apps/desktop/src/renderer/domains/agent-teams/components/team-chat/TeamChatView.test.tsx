// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamChatActions, TeamChatViewModel } from "./teamChatModel";
import { TeamChatView } from "./TeamChatView";

vi.mock("@vetta/theme-ui/chat", () => ({
	MessageInput: {
		Root: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		Surface: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		Routing: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		Attachments: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		Editor: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		Toolbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		ToolbarLeading: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		ToolbarTrailing: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	},
	InputBarPlaceholder: ({ texts, visible }: { texts: readonly string[]; visible: boolean }) =>
		visible ? <span>{texts[0]}</span> : null,
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
vi.mock("./TeamRecipientSelector", () => ({ TeamRecipientSelector: () => <div>members</div> }));

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
	hint: "Choose a member when needed",
	send: "Send",
	stop: "Stop",
	sending: "Working",
	failed: "Failed",
	retry: "Retry",
	attachFile: "Add file",
	attachImage: "Add image",
	removeAttachment: (name: string) => `Remove ${name}`,
};

function model(
	status: TeamChatViewModel["status"],
	editorEnabled = true,
): TeamChatViewModel {
	return {
		title: "Team",
		status,
		draft: "ship it",
		history: [],
		attachments: [],
		members: [],
		timelineItems: [],
		markdown,
		editorEnabled,
		canSend: status === "ready",
		labels,
	};
}

function actions(): TeamChatActions {
	return {
		setDraft: vi.fn(),
		selectLeader: vi.fn(),
		toggleMember: vi.fn(),
		selectFiles: vi.fn(async () => undefined),
		selectImages: vi.fn(async () => undefined),
		removeAttachment: vi.fn(),
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

	it("makes the shared Lexical editor editable when loading completes", async () => {
		const viewActions = actions();
		const view = render(<TeamChatView model={model("loading", false)} actions={viewActions} />);
		const editor = screen.getByRole("textbox", { name: "Ask the team" });
		expect(editor.getAttribute("contenteditable")).toBe("false");

		view.rerender(<TeamChatView model={model("ready")} actions={viewActions} />);

		await waitFor(() => expect(editor.getAttribute("contenteditable")).toBe("true"));
	});

	it("installs attachment preview and toolbar actions as one capability", () => {
		const viewActions = actions();
		render(
			<TeamChatView
				model={{
					...model("ready"),
					attachments: [{ path: "C:/workspace/brief.md", name: "brief.md", kind: "file" }],
				}}
				actions={viewActions}
			/>,
		);

		expect(screen.getByText("brief.md")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Remove brief.md" }));
		expect(viewActions.removeAttachment).toHaveBeenCalledWith("C:/workspace/brief.md");
		expect(screen.getByRole("button", { name: "Add file" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add image" })).toBeTruthy();
	});

	it("keeps attachment actions before the guidance text", () => {
		render(<TeamChatView model={model("ready")} actions={actions()} />);

		const addFile = screen.getByRole("button", { name: "Add file" });
		const guidance = screen.getByText("Choose a member when needed");
		expect(addFile.compareDocumentPosition(guidance) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
	});
});
