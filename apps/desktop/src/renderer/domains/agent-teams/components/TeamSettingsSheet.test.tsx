// @vitest-environment jsdom

import type { AgentProfile, TeamDefinition } from "@vetta/agent-team";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TeamSettingsSheet } from "./TeamSettingsSheet";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, string | number>) =>
			values ? `${key}:${Object.values(values).join(":")}` : key,
	}),
}));
vi.mock("@vetta/theme-ui/overlays", () => ({
	DetailDrawer: ({ children, open }: { children: ReactNode; open: boolean }) =>
		open ? <div>{children}</div> : null,
	DetailDrawerEnter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@vetta/theme-ui/chat", () => ({
	AgentAvatarView: ({ name }: { name: string }) => <span data-testid="avatar">{name}</span>,
}));
vi.mock("@vetta/ui", () => ({
	Button: ({ children, variant: _v, size: _s, ...props }: { children: ReactNode } & Record<string, unknown>) => (
		<button {...props}>{children}</button>
	),
	Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
	DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
	Input: (props: Record<string, unknown>) => <input {...props} />,
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
		<div {...props}>{children}</div>
	),
	SelectValue: () => <span />,
	cn: (...values: readonly unknown[]) => values.filter(Boolean).join(" "),
}));

function agent(id: string): AgentProfile {
	return {
		id,
		revision: 1,
		name: id,
		description: `${id} does things`,
		mentionHandle: id,
		blueprintId: "builder",
		abilities: { skills: [], mcpServers: [], plugins: [] },
		scope: { kind: "library" },
		createdAt: 1,
		updatedAt: 1,
	};
}

const agents = [agent("alpha"), agent("beta"), agent("spare")];
const team: TeamDefinition = {
	id: "team",
	revision: 4,
	name: "Delivery Team",
	description: "ships things",
	leaderMemberId: "member-alpha",
	members: [
		{ id: "member-alpha", handle: "alpha", binding: { kind: "reference", agentProfileId: "alpha" } },
		{ id: "member-beta", handle: "beta", binding: { kind: "reference", agentProfileId: "beta" } },
	],
	orchestrationPolicyId: "leader-delegates-v1",
	contextPolicyId: "public-results-v1",
	createdAt: 1,
	updatedAt: 1,
};

function renderSheet(overrides: { onSave?: ReturnType<typeof vi.fn>; onOpenMember?: ReturnType<typeof vi.fn> } = {}) {
	const onSave = overrides.onSave ?? vi.fn(async () => team);
	const onOpenMember = overrides.onOpenMember ?? vi.fn();
	render(
		<TeamSettingsSheet
			open
			team={team}
			agents={agents}
			agentsById={new Map(agents.map((item) => [item.id, item]))}
			onClose={vi.fn()}
			onSave={onSave}
			onDelete={vi.fn()}
			onOpenMember={onOpenMember}
		/>,
	);
	return { onSave, onOpenMember };
}

describe("TeamSettingsSheet", () => {
	it("keeps saving disabled until the draft actually changes", async () => {
		const { onSave } = renderSheet();
		const save = screen.getByRole("button", { name: /settings.saveChanges/ });
		expect(save).toHaveProperty("disabled", true);

		const user = userEvent.setup();
		await user.type(screen.getByLabelText("teams.name"), "!");
		expect(screen.getByRole("button", { name: /settings.saveChanges/ })).toHaveProperty("disabled", false);

		await user.click(screen.getByRole("button", { name: /settings.saveChanges/ }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team", name: "Delivery Team!" })),
		);
	});

	it("edits the team description, which had no editor before", async () => {
		const { onSave } = renderSheet();
		const user = userEvent.setup();

		await user.clear(screen.getByLabelText("settings.description"));
		await user.type(screen.getByLabelText("settings.description"), "owns delivery");
		await user.click(screen.getByRole("button", { name: /settings.saveChanges/ }));

		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ description: "owns delivery" })),
		);
	});

	it("promotes a leader and refuses to empty the roster", async () => {
		const { onSave } = renderSheet();
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "settings.makeLeader:beta" }));
		await user.click(screen.getByRole("button", { name: "teams.removeMember:alpha" }));
		await user.click(screen.getByRole("button", { name: "teams.removeMember:beta" }));
		expect(screen.getByText("settings.lastMember")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: /settings.saveChanges/ }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ memberIds: ["beta"], leaderId: "beta" })),
		);
	});

	it("opens a member profile instead of editing abilities inline", async () => {
		const { onOpenMember } = renderSheet();
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "alpha" }));
		expect(onOpenMember).toHaveBeenCalledWith("alpha");
	});
});
