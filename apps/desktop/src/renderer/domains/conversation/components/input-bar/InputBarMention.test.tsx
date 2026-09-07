// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputBarMention } from "./InputBarMention";
import type { InputBarModel } from "./types";

afterEach(cleanup);

const labels: NonNullable<InputBarModel["routing"]>["labels"] = {
	trigger: "Mention members",
	title: "Mention team members",
	hint: "The lead takes over when nobody is mentioned.",
	empty: "No members",
	clear: "Clear all",
	selected: (count) => `${count} members`,
};

function participant(
	overrides: Partial<NonNullable<InputBarModel["routing"]>["participants"][number]> = {},
): NonNullable<InputBarModel["routing"]>["participants"][number] {
	return {
		id: "member-1",
		name: "Research",
		avatar: "avatar.png",
		blueprintId: "researcher",
		badgeLabel: "Leader",
		selected: false,
		status: "idle",
		onSelect: vi.fn(),
		...overrides,
	};
}

describe("InputBarMention", () => {
	it("opens the panel from the @ icon and toggles a member through the controlled action", async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		render(
			<InputBarMention
				model={{ labels, participants: [participant({ onSelect, statusLabel: "Replying", status: "working" })] }}
			/>,
		);

		const trigger = screen.getByRole("button", { name: "Mention members" });
		expect(trigger.querySelector("span")?.className).toContain("icon-[solar--mention-circle-linear]");

		await user.click(trigger);
		expect(screen.getByText("Mention team members")).toBeTruthy();
		expect(screen.getByText("Leader")).toBeTruthy();
		expect(screen.getByText("Replying")).toBeTruthy();
		expect(screen.getByText("The lead takes over when nobody is mentioned.")).toBeTruthy();
		expect(screen.queryByText("Clear all")).toBeNull();

		await user.click(screen.getByRole("button", { name: /Research/ }));
		expect(onSelect).toHaveBeenCalledOnce();
	});

	it("names the only mentioned member on the capsule", () => {
		render(
			<InputBarMention
				model={{
					labels,
					participants: [
						participant({ selected: true }),
						participant({ id: "member-2", name: "Build" }),
					],
				}}
			/>,
		);

		expect(screen.getByRole("button", { name: "Research" })).toBeTruthy();
	});

	it("renders several mentioned members as an avatar capsule and clears them all", async () => {
		const user = userEvent.setup();
		const first = vi.fn();
		const second = vi.fn();
		const { container } = render(
			<InputBarMention
				model={{
					labels,
					participants: [
						participant({ id: "member-1", selected: true, onSelect: first }),
						participant({ id: "member-2", name: "Build", selected: true, onSelect: second }),
						participant({ id: "member-3", name: "Review", selected: false }),
					],
				}}
			/>,
		);

		const trigger = screen.getByRole("button", { name: "2 members" });
		expect(container.querySelectorAll("img")).toHaveLength(2);

		await user.click(trigger);
		await user.click(screen.getByRole("button", { name: "Clear all" }));
		expect(first).toHaveBeenCalledOnce();
		expect(second).toHaveBeenCalledOnce();
	});

	it("shows the empty hint when the team has no members", async () => {
		const user = userEvent.setup();
		render(<InputBarMention model={{ labels, participants: [] }} />);

		await user.click(screen.getByRole("button", { name: "Mention members" }));
		expect(screen.getByText("No members")).toBeTruthy();
	});
});
