// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamChatViewModel } from "./teamChatModel";
import { allocateTeamMemberRosterWidths, TeamMemberRoster } from "./TeamMemberRoster";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: { name?: string }) => (values?.name ? `${key}:${values.name}` : key),
	}),
}));
vi.mock("@vetta-org/theme-ui/chat", () => ({
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
	it("shares constrained width across every member without exceeding the container", () => {
		const measurements = [
			{ natural: 100, compact: 20 },
			{ natural: 80, compact: 20 },
			{ natural: 60, compact: 20 },
		];

		expect(allocateTeamMemberRosterWidths(measurements, 240)).toEqual([100, 80, 60]);
		expect(allocateTeamMemberRosterWidths(measurements, 210)).toEqual([75, 75, 60]);
		expect(allocateTeamMemberRosterWidths(measurements, 180)).toEqual([60, 60, 60]);
		expect(allocateTeamMemberRosterWidths(measurements, 120)).toEqual([40, 40, 40]);
		expect(allocateTeamMemberRosterWidths(measurements, 60)).toEqual([20, 20, 20]);
		expect(allocateTeamMemberRosterWidths(measurements, 30)).toEqual([10, 10, 10]);
	});

	it("restores member labels after the roster narrows and widens again", () => {
		let rosterWidth = 202;
		let notifyResize: () => void = () => undefined;
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: ResizeObserverCallback) {
					notifyResize = () => callback([], this as unknown as ResizeObserver);
				}
				observe() {}
				disconnect() {}
				unobserve() {}
			},
		);
		const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
			return this.getAttribute("data-team-member-roster-group") === "true" ? rosterWidth : 0;
		});
		const scrollWidth = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
			if (this.getAttribute("data-member-session-label") !== "true") return 0;
			return this.textContent === "Research" ? 70 : 50;
		});
		const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const memberId = this.getAttribute("data-member-session-id");
			if (this.getAttribute("data-member-session-label-minimum") === "true") return { width: 12 } as DOMRect;
			if (this.getAttribute("data-member-session-label") === "true") {
				const natural = this.textContent === "Research" ? 70 : 50;
				return { width: this.style.width ? Number.parseFloat(this.style.width) : natural } as DOMRect;
			}
			if (memberId) {
				const label = this.querySelector('[data-member-session-label="true"]') as HTMLElement;
				const natural = label.textContent === "Research" ? 70 : 50;
				const labelWidth = label.style.width ? Number.parseFloat(label.style.width) : natural;
				return { width: 38 + labelWidth } as DOMRect;
			}
			return { width: 0 } as DOMRect;
		});

		try {
			render(<TeamMemberRoster members={members} onOpenMember={vi.fn()} />);
			const research = screen.getByRole("button", { name: "chat.memberSession:Research" });
			const build = screen.getByRole("button", { name: "chat.memberSession:Build" });
			const researchLabel = research.querySelector('[data-member-session-label="true"]') as HTMLElement;
			const buildLabel = build.querySelector('[data-member-session-label="true"]') as HTMLElement;
			expect(research.style.width).toBe("");
			expect(build.style.width).toBe("");
			expect(researchLabel.style.width).toBe("");
			act(() => frames.shift()?.(0));
			expect(researchLabel.style.width).toBe("70px");
			expect(buildLabel.style.width).toBe("50px");
			expect(researchLabel.className).toContain("ml-1.5");

			rosterWidth = 160;
			act(() => notifyResize());
			expect(researchLabel.style.width).toBe("70px");
			act(() => frames.shift()?.(16));
			expect(researchLabel.style.width).toBe("42px");
			expect(buildLabel.style.width).toBe("42px");
			expect(Number.parseFloat(researchLabel.style.width) + Number.parseFloat(buildLabel.style.width) + 76).toBe(
				rosterWidth,
			);
			expect(build.querySelector('[data-member-session-label="true"]')?.className).toContain("truncate");

			rosterWidth = 202;
			act(() => notifyResize());
			act(() => frames.shift()?.(32));
			expect(researchLabel.style.width).toBe("70px");
			expect(buildLabel.style.width).toBe("50px");
		} finally {
			clientWidth.mockRestore();
			scrollWidth.mockRestore();
			rect.mockRestore();
			vi.unstubAllGlobals();
		}
	});

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
