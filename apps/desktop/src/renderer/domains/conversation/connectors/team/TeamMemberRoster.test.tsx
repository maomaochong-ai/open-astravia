// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamChatViewModel } from "./teamChatModel";
import { TeamMemberRoster } from "./TeamMemberRoster";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: { name?: string }) => (values?.name ? `${key}:${values.name}` : key),
	}),
}));
vi.mock("@vetta/theme-ui/chat", () => ({
	AgentAvatarView: ({ name }: { name: string }) => <span data-testid={`avatar-${name}`} />,
}));

afterEach(cleanup);

const members = [
	{
		id: "member-1",
		kind: "agent",
		name: "Research",
		handle: "research",
		blueprintId: "researcher",
		avatar: "/research.webp",
		selected: false,
		status: "idle",
	},
	{
		id: "member-2",
		kind: "agent",
		name: "Build",
		handle: "build",
		blueprintId: "builder",
		avatar: "/build.webp",
		selected: false,
		status: "idle",
	},
] as unknown as TeamChatViewModel["members"];

describe("TeamMemberRoster", () => {
	it("renders one named capsule per member and opens the clicked member", () => {
		const onOpenMember = vi.fn();
		render(
			<TeamMemberRoster
				members={members}
				memberRuntimeIds={{ "member-1": "runtime-1" }}
				onOpenMember={onOpenMember}
			/>,
		);

		expect(screen.getByText("Research")).toBeTruthy();
		expect(screen.getByText("Build")).toBeTruthy();
		// 没有运行时的成员没有可打开的会话，胶囊保持禁用。
		expect(screen.getByRole("button", { name: "chat.memberSession:Build" }).hasAttribute("disabled")).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "chat.memberSession:Research" }));
		expect(onOpenMember).toHaveBeenCalledWith("member-1");
	});

	it("marks the member whose session is open", () => {
		render(
			<TeamMemberRoster
				members={members}
				memberRuntimeIds={{ "member-1": "runtime-1", "member-2": "runtime-2" }}
				activeMemberId="member-2"
				onOpenMember={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "chat.memberSession:Build" }).getAttribute("data-member-session-active"),
		).toBe("true");
		expect(screen.getByRole("button", { name: "chat.memberSession:Research" }).getAttribute("aria-pressed")).toBe(
			"false",
		);
	});

	it("offers a main-chat capsule and a settings action inside the roster", () => {
		const onBackToTeam = vi.fn();
		const onOpenSettings = vi.fn();
		render(
			<TeamMemberRoster
				members={members}
				memberRuntimeIds={{ "member-1": "runtime-1", "member-2": "runtime-2" }}
				activeMemberId="member-2"
				onOpenMember={vi.fn()}
				onBackToTeam={onBackToTeam}
				onOpenSettings={onOpenSettings}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "chat.backToTeam" }));
		expect(onBackToTeam).toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "chat.configure" }));
		expect(onOpenSettings).toHaveBeenCalled();
	});

	it("hides the main-chat capsule while the Team conversation is open", () => {
		render(<TeamMemberRoster members={members} onOpenMember={vi.fn()} onBackToTeam={vi.fn()} />);

		expect(screen.queryByRole("button", { name: "chat.backToTeam" })).toBeNull();
	});

	it("marks a streaming member so the capsule can animate", () => {
		const streamingMembers = [
			{ ...members[0], status: "working" },
			members[1],
		] as unknown as TeamChatViewModel["members"];
		render(
			<TeamMemberRoster
				members={streamingMembers}
				memberRuntimeIds={{ "member-1": "runtime-1", "member-2": "runtime-2" }}
				onOpenMember={vi.fn()}
			/>,
		);

		expect(
			screen
				.getByRole("button", { name: "chat.memberSession:Research" })
				.getAttribute("data-member-session-streaming"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: "chat.memberSession:Build" })
				.hasAttribute("data-member-session-streaming"),
		).toBe(false);
	});

	it("renders nothing without members", () => {
		const { container } = render(<TeamMemberRoster members={[]} onOpenMember={vi.fn()} />);
		expect(container.firstChild).toBeNull();
	});
});
