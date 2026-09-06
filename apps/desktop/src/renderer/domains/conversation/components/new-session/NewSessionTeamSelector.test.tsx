// @vitest-environment jsdom

import { createAgentTeamFixture } from "@vetta/agent-team";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewSessionTeamSelector } from "./NewSessionTeamSelector";
import { type NewSessionTargetKey, teamTargetKey } from "./target";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, number>) =>
			key === "newSession.teamSelector.memberCount" ? `${values?.count ?? 0} members` : key,
	}),
}));

afterEach(cleanup);

describe("NewSessionTeamSelector", () => {
	const document = createAgentTeamFixture();
	const team = document.teams[0];
	if (!team) throw new Error("missing Team fixture");

	beforeEach(() => {
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				agentTeams: {
					list: vi.fn(async () => document),
				},
			},
		});
	});

	it("reuses the bounded member avatar stack in the menu and selected trigger", async () => {
		const onSelect = vi.fn();
		function Harness(): JSX.Element {
			const [selectedKey, setSelectedKey] = useState<NewSessionTargetKey | null>(null);
			return (
				<NewSessionTeamSelector
					selectedKey={selectedKey}
					onSelect={(targetKey) => {
						setSelectedKey(targetKey);
						onSelect(targetKey);
					}}
				/>
			);
		}

		const user = userEvent.setup();
		render(<Harness />);
		const trigger = screen.getByRole("button", { name: "newSession.teamSelector.triggerTitle" });
		await user.click(trigger);

		const option = await screen.findByRole("option", { name: /Vetta Team/ });
		const optionStack = option.querySelector('[data-avatar-stack="true"]');
		expect(optionStack).not.toBeNull();
		expect(optionStack?.querySelectorAll("img")).toHaveLength(3);
		expect(optionStack?.querySelector('[data-avatar-overflow="1"]')).not.toBeNull();

		await user.click(option);
		expect(onSelect).toHaveBeenCalledWith(teamTargetKey(team.id));
		const selectedTrigger = screen.getByRole("button", { name: "newSession.teamSelector.triggerTitle" });
		expect(within(selectedTrigger).getByText("Vetta Team")).toBeDefined();
		expect(selectedTrigger.querySelectorAll("img")).toHaveLength(3);
		expect(selectedTrigger.querySelector('[data-avatar-overflow="1"]')).not.toBeNull();
	});
});
