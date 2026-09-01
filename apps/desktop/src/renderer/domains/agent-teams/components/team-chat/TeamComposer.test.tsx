// @vitest-environment jsdom

import type { TeamDefinition } from "@vetta/agent-team";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamComposer } from "./TeamComposer";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@domains/chat/components/SendButton", () => ({
	SendButton: ({ onSend, pending }: { onSend: () => void; pending?: { label: ReactNode } }) => (
		<button type="button" onClick={onSend}>
			{pending?.label ?? "send-button"}
		</button>
	),
}));

afterEach(cleanup);

const team: TeamDefinition = {
	id: "team",
	revision: 1,
	name: "Team",
	description: "",
	leaderMemberId: "leader",
	members: [
		{
			id: "leader",
			handle: "vetta",
			binding: { kind: "reference", agentProfileId: "agent-leader" },
		},
		{
			id: "researcher",
			handle: "research",
			binding: { kind: "reference", agentProfileId: "agent-researcher" },
		},
	],
	orchestrationPolicyId: "leader-delegates-v1",
	contextPolicyId: "public-results-v1",
	createdAt: 1,
	updatedAt: 1,
};

describe("TeamComposer", () => {
	it("routes by member chips and inserts a readable @mention", async () => {
		const user = userEvent.setup();
		const onTextChange = vi.fn();
		const onSelectedMemberIdsChange = vi.fn();
		render(
			<TeamComposer
				team={team}
				text="Please"
				selectedMemberIds={[]}
				sending={false}
				disabled={false}
				onTextChange={onTextChange}
				onSelectedMemberIdsChange={onSelectedMemberIdsChange}
				onSend={vi.fn()}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "@research" }));
		expect(onSelectedMemberIdsChange).toHaveBeenCalledWith(["researcher"]);
		expect(onTextChange).toHaveBeenCalledWith("Please @research ");
	});

	it("sends on Enter but keeps Shift+Enter for multiline input", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		render(
			<TeamComposer
				team={team}
				text="Ready"
				selectedMemberIds={[]}
				sending={false}
				disabled={false}
				onTextChange={vi.fn()}
				onSelectedMemberIdsChange={vi.fn()}
				onSend={onSend}
			/>,
		);

		const input = screen.getByRole("textbox", { name: "chat.placeholder" });
		await user.type(input, "{Shift>}{Enter}{/Shift}");
		expect(onSend).not.toHaveBeenCalled();
		await user.type(input, "{Enter}");
		expect(onSend).toHaveBeenCalledTimes(1);
	});
});
