// @vitest-environment jsdom

import type { TeamDefinition } from "@vetta/agent-team";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamComposer } from "./TeamComposer";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

const team: TeamDefinition = {
	id: "team",
	revision: 1,
	name: "Team",
	description: "",
	leaderMemberId: "leader",
	members: [
		{ id: "leader", handle: "vetta", binding: { kind: "reference", agentProfileId: "agent-leader" } },
		{ id: "researcher", handle: "research", binding: { kind: "reference", agentProfileId: "agent-researcher" } },
	],
	orchestrationPolicyId: "leader-delegates-v1",
	contextPolicyId: "public-results-v1",
	createdAt: 1,
	updatedAt: 1,
};

const document = { schemaVersion: 1 as const, revision: 1, agents: [], teams: [team] };

describe("TeamComposer", () => {
	it("routes by member chips and inserts a readable @mention", async () => {
		const user = userEvent.setup();
		const onTextChange = vi.fn();
		const onSelectedMemberIdsChange = vi.fn();
		render(
			<TeamComposer
				team={team}
				document={document}
				text="Please"
				selectedMemberIds={[]}
				onTextChange={onTextChange}
				onSelectedMemberIdsChange={onSelectedMemberIdsChange}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "@research" }));
		expect(onSelectedMemberIdsChange).toHaveBeenCalledWith(["researcher"]);
		expect(onTextChange).toHaveBeenCalledWith("Please @research ");
	});

	it("shows selected state for a routed member", async () => {
		const user = userEvent.setup();
		const onSelectedMemberIdsChange = vi.fn();
		render(
			<TeamComposer
				team={team}
				document={document}
				text="Ready"
				selectedMemberIds={[]}
				onTextChange={vi.fn()}
				onSelectedMemberIdsChange={onSelectedMemberIdsChange}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "@research" }));
		expect(onSelectedMemberIdsChange).toHaveBeenCalledWith(["researcher"]);
	});
});
