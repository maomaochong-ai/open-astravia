// @vitest-environment jsdom

import { confirmDialogAtom } from "@shared/store/atoms";
import type { AgentProfileDeleteImpact } from "@vetta/agent-team";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentCenterPage } from "./AgentCenterPage";

const mocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	previewAgentDelete: vi.fn(),
	deleteAgent: vi.fn(),
	deleteTeam: vi.fn(),
	selectTeam: vi.fn(),
	navigate: vi.fn(),
	search: vi.fn(() => ({ agent: "agent" })),
}));

const agent = {
	id: "agent",
	revision: 2,
	name: "Custom agent",
	description: "",
	mentionHandle: "internal-handle",
	blueprintId: "builder",
	abilities: { skills: [], mcpServers: [], plugins: [] },
	scope: { kind: "library" },
	createdAt: 1,
	updatedAt: 1,
};
const team = { id: "team-a", revision: 3, name: "Team A", members: [], leaderMemberId: "" };

vi.mock("jotai", async (importOriginal) => ({
	...(await importOriginal<typeof import("jotai")>()),
	useSetAtom: (atom: unknown) => (atom === confirmDialogAtom ? mocks.confirm : vi.fn()),
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, string | number>) =>
			values ? `${key}:${Object.values(values).join(":")}` : key,
	}),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mocks.navigate,
	useSearch: () => mocks.search(),
}));
vi.mock("@shared/agent-teams/team-session-events", () => ({
	notifyAgentTeamConfigurationChanged: vi.fn(),
}));
vi.mock("./AgentCenterView", () => ({
	AgentCenterView: ({ onDeleteTeam }: { onDeleteTeam: () => void }) => (
		<button type="button" onClick={onDeleteTeam}>
			delete-team
		</button>
	),
}));
vi.mock("./AgentProfileSheet", () => ({
	AgentProfileSheet: ({ onDelete }: { onDelete?: () => void }) => (
		<button type="button" onClick={onDelete}>
			delete-agent
		</button>
	),
}));
vi.mock("./TeamSettingsSheet", () => ({ TeamSettingsSheet: () => <div>team sheet</div> }));
vi.mock("../hooks/useAgentCenterModel", () => ({
	useAgentCenterModel: () => ({
		loading: false,
		document: { schemaVersion: 1, revision: 1, agents: [agent], teams: [team] },
		teams: [team],
		agents: [agent],
		selectedTeam: team,
		findAgent: () => agent,
		findTeam: () => team,
		blueprints: [],
		capabilities: [],
		agentsById: new Map([[agent.id, agent]]),
		actions: {
			previewAgentDelete: mocks.previewAgentDelete,
			deleteAgent: mocks.deleteAgent,
			deleteTeam: mocks.deleteTeam,
			selectTeam: mocks.selectTeam,
			submitAssembly: vi.fn(),
			previewAgent: vi.fn(),
			saveAgent: vi.fn(),
			createAgentFromDraft: vi.fn(),
			saveTeam: vi.fn(),
		},
	}),
}));

describe("AgentCenterPage", () => {
	it("shows every affected team and deletes with the reviewed reference set", async () => {
		const impact: AgentProfileDeleteImpact = {
			agentProfileId: "agent",
			teams: [
				{
					teamId: "team-a",
					teamRevision: 2,
					teamName: "Team A",
					removedMemberIds: ["member-a"],
					deletesTeam: false,
					nextLeaderMemberId: "member-b",
					nextLeaderName: "New lead",
				},
				{
					teamId: "team-b",
					teamRevision: 4,
					teamName: "Team B",
					removedMemberIds: ["member-c"],
					deletesTeam: true,
				},
			],
		};
		mocks.previewAgentDelete.mockResolvedValue(impact);
		mocks.deleteAgent.mockResolvedValue(true);
		const user = userEvent.setup();
		render(<AgentCenterPage />);

		await user.click(screen.getByRole("button", { name: "delete-agent" }));
		await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
		const confirmation = mocks.confirm.mock.calls.at(-1)?.[0];
		expect(confirmation.message).toContain("Team A");
		expect(confirmation.message).toContain("Team B");
		expect(confirmation.message).toContain("New lead");

		act(() => confirmation.onConfirm());
		await waitFor(() =>
			expect(mocks.deleteAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "agent" }), impact),
		);
		await waitFor(() =>
			expect(mocks.navigate).toHaveBeenCalledWith(expect.objectContaining({ to: "/agents", search: {} })),
		);
	});

	it("clears the team selection after the selected team is deleted", async () => {
		mocks.deleteTeam.mockResolvedValue(true);
		const user = userEvent.setup();
		render(<AgentCenterPage />);

		await user.click(screen.getByRole("button", { name: "delete-team" }));
		const confirmation = mocks.confirm.mock.calls.at(-1)?.[0];
		expect(confirmation.message).toContain("Team A");

		act(() => confirmation.onConfirm());
		await waitFor(() => expect(mocks.deleteTeam).toHaveBeenCalledWith(expect.objectContaining({ id: "team-a" })));
		await waitFor(() => expect(mocks.selectTeam).toHaveBeenCalledWith(undefined));
	});
});
