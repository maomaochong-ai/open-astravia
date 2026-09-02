// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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

afterEach(cleanup);

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
};

describe("TeamMessageFeed", () => {
	it("labels empty-state members by display name without exposing handles", () => {
		render(
			<TeamMessageFeed status="ready" items={[]} members={[member]} markdown={markdown} labels={labels} />,
		);
		expect(screen.getByTitle("Vetta")).toBeTruthy();
		expect(screen.queryByTitle("@vetta")).toBeNull();
	});

	it("renders accumulated streaming text instead of hiding it behind a skeleton", () => {
		const items: TeamTimelineItemViewModel[] = [
			{
				id: "stream:turn",
				kind: "member",
				member,
				text: "partial response",
				pending: true,
			},
		];
		render(
			<TeamMessageFeed
				status="streaming"
				items={items}
				members={[member]}
				markdown={markdown}
				labels={labels}
			/>,
		);
		expect(screen.getByText("partial response")).toBeTruthy();
	});
});
