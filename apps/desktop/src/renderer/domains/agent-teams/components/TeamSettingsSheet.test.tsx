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

	it("writes a per-team assignment for one member and leaves the profile alone", async () => {
		const { onSave } = renderSheet();
		const user = userEvent.setup();

		const row = screen.getByRole("button", { name: "settings.editAssignment:alpha" }).closest("li");
		await user.click(screen.getByRole("button", { name: "settings.editAssignment:alpha" }));
		// 编辑区必须长在成员行内。抽屉底层是 modal 的 Radix Content，会 trap focus 并
		// hideOthers；portal 到 body 的嵌套弹窗按钮点得动，但输入框拿不住焦点。
		expect(row?.contains(screen.getByLabelText("settings.assignmentResponsibility"))).toBe(true);
		await user.type(screen.getByLabelText("settings.assignmentResponsibility"), "Owns the release checklist");
		await user.type(screen.getByLabelText("settings.assignmentInstructions"), "Escalate schema changes.");
		await user.click(screen.getByRole("button", { name: "settings.assignmentApply" }));

		// 团队内那句单独成条摆出来，本体描述照旧留在成员行里。
		expect(screen.getByText("Owns the release checklist")).toBeTruthy();
		expect(screen.getByText("settings.assignmentBadge")).toBeTruthy();
		expect(screen.getByText("settings.assignmentHasInstructions")).toBeTruthy();
		expect(screen.getByText("alpha does things")).toBeTruthy();

		await user.click(screen.getByRole("button", { name: /settings.saveChanges/ }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith(
				expect.objectContaining({
					assignments: {
						alpha: { responsibility: "Owns the release checklist", instructions: "Escalate schema changes." },
					},
				}),
			),
		);
	});

	it("clears an assignment when both fields are emptied", async () => {
		const assigned: TeamDefinition = {
			...team,
			members: [
				{ ...team.members[0], assignment: { responsibility: "Owns the release checklist" } },
				...team.members.slice(1),
			],
		};
		const onSave = vi.fn(async () => assigned);
		render(
			<TeamSettingsSheet
				open
				team={assigned}
				agents={agents}
				agentsById={new Map(agents.map((item) => [item.id, item]))}
				onClose={vi.fn()}
				onSave={onSave}
				onDelete={vi.fn()}
				onOpenMember={vi.fn()}
			/>,
		);
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "settings.editAssignment:alpha" }));
		await user.clear(screen.getByLabelText("settings.assignmentResponsibility"));
		await user.click(screen.getByRole("button", { name: "settings.assignmentApply" }));

		// 清空后回到虚线入口（两位成员都没有任务书），不再显示团队内职责条。
		expect(screen.getAllByText("settings.assignmentEmpty")).toHaveLength(2);
		expect(screen.queryByText("settings.assignmentBadge")).toBeNull();
		await user.click(screen.getByRole("button", { name: /settings.saveChanges/ }));
		await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assignments: {} })));
	});

	it("opens a member profile instead of editing abilities inline", async () => {
		const { onOpenMember } = renderSheet();
		const user = userEvent.setup();

		await user.click(screen.getByRole("button", { name: "alpha" }));
		expect(onOpenMember).toHaveBeenCalledWith("alpha");
	});
});
