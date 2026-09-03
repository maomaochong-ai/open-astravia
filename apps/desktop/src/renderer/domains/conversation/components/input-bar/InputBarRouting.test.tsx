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
					leaderLabel: "Leader",
					leaderSelected: true,
					onSelectLeader: vi.fn(),
					participants: [
						{
							id: "researcher",
							name: "Research",
							avatar: "avatar.png",
							blueprintId: "researcher",
							selected: false,
							status: "idle",
							onSelect,
						},
					],
				}}
			/>,
		);

		expect(container.querySelector("img")?.getAttribute("src")).toBe("avatar.png");
		expect(screen.getByRole("button", { name: "Leader" }).getAttribute("aria-pressed")).toBe("true");
		await user.click(screen.getByRole("button", { name: "Research" }));
		expect(onSelect).toHaveBeenCalledOnce();
	});
});
