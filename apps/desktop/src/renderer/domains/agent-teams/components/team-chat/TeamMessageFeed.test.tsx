// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamMemberViewModel, TeamTimelineItemViewModel } from "./teamChatModel";
import { TeamMessageFeed } from "./TeamMessageFeed";

vi.mock("react-virtuoso", () => ({
	Virtuoso: ({
		data,
		itemContent,
	}: {
		data: readonly unknown[];
		itemContent: (index: number, item: unknown) => ReactNode;
	}) => <div>{data.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)}</div>,
}));

vi.mock("@vetta/theme-ui/chat", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@vetta/theme-ui/chat")>();
	return {
		...actual,
		TextBlockView: ({ text }: { text: string }) => <div>{text}</div>,
	};
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const member: TeamMemberViewModel = {
	id: "leader",
	name: "Vetta",
	handle: "vetta",
	blueprintId: "leader",
	selected: false,
	status: "working",
};
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
	sending: "Working",
	failed: "Failed",
	copy: "Copy",
	copied: "Copied",
	navigation: {
		open: "Open navigation",
		title: "Navigation",
		count: (count: number) => `${count} turns`,
		noResults: "No results",
		close: "Close",
		searchPlaceholder: "Search",
		searchLabel: "Search messages",
		jumpTo: (preview: string) => `Jump to ${preview}`,
		emptyRequest: "Empty request",
	},
};

describe("TeamMessageFeed", () => {
	it("labels empty-state members by display name without exposing handles", () => {
		render(
			<TeamMessageFeed feedKey="team" status="ready" items={[]} members={[member]} markdown={markdown} labels={labels} />,
		);
		expect(screen.getByTitle("Vetta")).toBeTruthy();
		expect(screen.queryByTitle("@vetta")).toBeNull();
	});

	it("renders accumulated streaming text instead of hiding it behind a skeleton", () => {
		const items: TeamTimelineItemViewModel[] = [
			{
				id: "member:request:leader",
				kind: "member",
				requestId: "request",
				member,
				text: "partial response",
				pending: true,
				timestamp: 1,
			},
		];
		render(
			<TeamMessageFeed
				feedKey="team"
				status="streaming"
				items={items}
				members={[member]}
				markdown={markdown}
				labels={labels}
			/>,
		);
		expect(screen.getByText("partial response")).toBeTruthy();
	});

	it("composes attachment rendering into user messages and opens files through the host model", async () => {
		const items: TeamTimelineItemViewModel[] = [
			{
				id: "user:request",
				kind: "user",
				requestId: "request",
				text: "Review this",
				pending: false,
				timestamp: 1,
				attachments: [{ kind: "file", path: "C:/private/workspace/notes.txt" }],
				targetMemberIds: [],
			},
		];
		render(
			<TeamMessageFeed
				feedKey="team"
				status="ready"
				items={items}
				members={[member]}
				markdown={markdown}
				labels={labels}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: "notes.txt" }));
		expect(markdown.onOpenFile).toHaveBeenCalledWith("C:/private/workspace/notes.txt");
		expect(screen.queryByText("C:/private/workspace/notes.txt")).toBeNull();
	});
});
