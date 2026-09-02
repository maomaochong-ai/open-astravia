// @vitest-environment jsdom

import type { AgentProfileDeleteImpact } from "@vetta/agent-team";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AgentLibraryPage } from "./AgentLibraryPage";

const mocks = vi.hoisted(() => ({
	confirm: vi.fn(),
	previewAgentDelete: vi.fn(),
	deleteAgent: vi.fn(),
}));

vi.mock("jotai", async (importOriginal) => ({
	...(await importOriginal<typeof import("jotai")>()),
	useSetAtom: () => mocks.confirm,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, string | number>) =>
			values ? `${key}:${Object.values(values).join(":")}` : key,
	}),
}));
vi.mock("@vetta/ui", () => ({
	Button: ({ children, variant: _variant, ...props }: { children: ReactNode } & Record<string, unknown>) => (
		<button {...props}>{children}</button>
	),
}));
vi.mock("./AgentProfileEditor", () => ({ AgentProfileEditor: () => <div>profile editor</div> }));
vi.mock("../hooks/useAgentLibraryModel", () => ({
	useAgentLibraryModel: () => {
		const selected = {
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
		return {
			document: { schemaVersion: 1, revision: 1, agents: [selected], teams: [] },
			libraryAgents: [selected],
			blueprints: [],
			capabilities: [],
			selected,
			selectedId: selected.id,
			loading: false,
			actions: {
				previewAgentDelete: mocks.previewAgentDelete,
				deleteAgent: mocks.deleteAgent,
				selectAgent: vi.fn(),
				createAgent: vi.fn(),
				previewAgent: vi.fn(),
				saveAgent: vi.fn(),
			},
		};
	},
}));

describe("AgentLibraryPage", () => {
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
		render(<AgentLibraryPage />);

		await user.click(screen.getByRole("button", { name: "library.delete" }));
		await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
		const confirmation = mocks.confirm.mock.calls[0]?.[0];
		expect(confirmation.message).toContain("Team A");
		expect(confirmation.message).toContain("Team B");
		expect(confirmation.message).toContain("New lead");

		act(() => confirmation.onConfirm());
		await waitFor(() =>
			expect(mocks.deleteAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "agent" }), impact),
		);
	});
});
