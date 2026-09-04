// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputBarRouting } from "./InputBarRouting";

afterEach(cleanup);

describe("InputBarRouting", () => {
	it("renders participant avatars and routes through controlled actions", async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		const { container } = render(
			<InputBarRouting
				model={{
					participants: [
						{
							id: "researcher",
							name: "Research",
							avatar: "avatar.png",
							blueprintId: "researcher",
							badgeLabel: "Leader",
							statusLabel: "Replying",
							selected: false,
							status: "working",
							onSelect,
						},
					],
				}}
			/>,
		);

		expect(container.querySelector("img")?.getAttribute("src")).toBe("avatar.png");
		expect(screen.getByText("@").className).toContain("bg-black/50");
		expect(screen.getByText("@").className).toContain("group-hover/member-avatar:opacity-100");
		expect(screen.getByText("Leader").className).toContain("bg-primary");
		expect(screen.getByText("Leader").className).toContain("pointer-events-none");
		expect(screen.getByText("Leader").className).toContain("truncate");
		expect(screen.getByRole("button", { name: "Research · Leader · Replying" }).getAttribute("title")).toBe(
			"Research · Leader",
		);
		expect(screen.getByRole("status").textContent).toContain("Research · Replying");
		expect(screen.getAllByRole("button")).toHaveLength(1);
		await user.click(screen.getByRole("button", { name: "Research · Leader · Replying" }));
		expect(onSelect).toHaveBeenCalledOnce();
	});

	it("keeps the selected state visible while the pointer is over the avatar", () => {
		const { container } = render(
			<InputBarRouting
				model={{
					participants: [
						{
							id: "researcher",
							name: "Research",
							avatar: "avatar.png",
							blueprintId: "researcher",
							selected: true,
							status: "idle",
							onSelect: vi.fn(),
						},
					],
				}}
			/>,
		);

		const button = screen.getByRole("button", { name: "Research" });
		expect(button.getAttribute("aria-pressed")).toBe("true");
		expect(button.getAttribute("data-selected")).toBe("true");
		expect(button.className).toContain("data-[selected=true]:hover:bg-primary/15");
		expect(container.querySelector("img")?.getAttribute("src")).toBe("avatar.png");
	});

	it("can omit the aggregate processing status while retaining member status semantics", () => {
		const { container } = render(
			<InputBarRouting
				model={{
					showStatusSummary: false,
					participants: [
						{
							id: "researcher",
							name: "Research",
							avatar: "avatar.png",
							blueprintId: "researcher",
							statusLabel: "Replying",
							selected: false,
							status: "working",
							onSelect: vi.fn(),
						},
					],
				}}
			/>,
		);

		expect(container.querySelector('[role="status"]')).toBeNull();
		expect(screen.getByRole("button", { name: "Research · Replying" })).toBeTruthy();
	});
});
