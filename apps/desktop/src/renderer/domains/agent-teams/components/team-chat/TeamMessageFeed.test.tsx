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
	kind: "agent",
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
	it.each(["user", "agent"] as const)(
		"keeps %s copy behavior when using message primitives directly",
		async (kind) => {
			const user = userEvent.setup();
			const message: Extract<TeamTimelineItemViewModel, { kind: "message" }>["message"] = kind === "user"
				? {
					id: "message",
					turnId: "turn",
					authorId: "local-user",
					kind,
					role: "user",
					deliveryPhase: "completed",
					text: "Public text",
				}
				: {
					id: "message",
					turnId: "turn",
					authorId: member.id,
					kind,
					role: "assistant",
					phase: "completed",
					blocks: [{ id: "text", type: "text", text: "Public text" }],
				};
			render(
				<TeamMessageFeed
					feedKey="team"
					status="ready"
					items={[{ kind: "message", id: message.id, message }]}
					members={[member]}
					markdown={markdown}
					labels={labels}
				/>,
			);
			await user.click(screen.getByRole("button", { name: "Copy" }));
			expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
			expect(await navigator.clipboard.readText()).toBe("Public text");
		},
	);

	it("does not mount a copy capability for an attachment-only message", () => {
		render(
			<TeamMessageFeed
				feedKey="team"
				status="ready"
				items={[{
					id: "attachment",
					kind: "message",
					message: {
						id: "attachment",
						turnId: "turn",
						authorId: "local-user",
						kind: "user",
						role: "user",
						deliveryPhase: "completed",
						text: "",
						attachments: [{ kind: "file", path: "C:/workspace/notes.txt" }],
					},
				}]}
				members={[member]}
				markdown={markdown}
				labels={labels}
			/>,
		);
		expect(screen.getByRole("button", { name: "notes.txt" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
	});

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
				kind: "message",
				message: {
					id: "member:request:leader",
					turnId: "request",
					authorId: member.id,
					kind: "agent",
					role: "assistant",
					phase: "streaming",
					blocks: [{ type: "text", id: "text", text: "partial response" }],
					timestamp: 1,
				},
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
				kind: "message",
				message: {
					id: "user:request",
					turnId: "request",
					authorId: "local-user",
					kind: "user",
					role: "user",
					deliveryPhase: "completed",
					text: "Review this",
					timestamp: 1,
					attachments: [{ kind: "file", path: "C:/private/workspace/notes.txt" }],
				},
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
