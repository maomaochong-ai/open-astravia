// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamMemberViewModel } from "./teamChatModel";
import { TeamComposer } from "./TeamComposer";

afterEach(cleanup);

const members: TeamMemberViewModel[] = [
	{
		id: "researcher",
		name: "Research",
		handle: "research",
		avatar: "avatar.png",
		blueprintId: "researcher",
		selected: false,
		status: "idle",
	},
];

describe("TeamComposer", () => {
	it("renders member avatars and routes through props-only actions", async () => {
		const user = userEvent.setup();
		const onToggleMember = vi.fn();
		const { container } = render(
			<TeamComposer
				members={members}
				leaderRouteLabel="Leader"
				onSelectLeader={vi.fn()}
				onToggleMember={onToggleMember}
			/>,
		);

		expect(container.querySelector("img")?.getAttribute("src")).toBe("avatar.png");
		await user.click(screen.getByRole("button", { name: "@research" }));
		expect(onToggleMember).toHaveBeenCalledWith("researcher");
	});

	it("marks the leader route selected when no member is selected", () => {
		render(
			<TeamComposer
				members={members}
				leaderRouteLabel="Leader"
				onSelectLeader={vi.fn()}
				onToggleMember={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: "Leader" }).getAttribute("aria-pressed")).toBe("true");
	});
});
