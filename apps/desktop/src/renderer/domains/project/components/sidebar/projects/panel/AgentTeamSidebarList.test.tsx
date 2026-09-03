// @vitest-environment jsdom

import { createInitialAgentTeamDocument } from "@vetta/agent-team";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTeamSidebarList } from "./AgentTeamSidebarList";

const router = vi.hoisted(() => ({
	currentPath: "/agent-teams/team/sessions/session-2",
	navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	useMatches: () => [{ pathname: router.currentPath }],
	useNavigate: () => router.navigate,
}));
vi.mock("@vetta/theme-ui/project", () => ({
	DefaultSessionRowView: ({
		active,
		label,
		onSelect,
	}: {
		active: boolean;
		label: string;
		onSelect: () => void;
	}) => (
		<button type="button" data-active={String(active)} onClick={onSelect}>
			{label}
		</button>
	),
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, number>) =>
			key === "chat.sessionLabel" ? `Chat ${values?.index ?? ""}` : key,
	}),
}));
vi.mock("../../../../../agent-teams/lib/preset-presentation", () => ({
	teamDisplayName: (team: { name: string }) => team.name,
}));

afterEach(cleanup);

describe("AgentTeamSidebarList", () => {
	beforeEach(() => {
		router.navigate.mockReset();
		const initial = createInitialAgentTeamDocument();
		const team = initial.teams[0];
		if (!team) throw new Error("missing Team fixture");
		router.currentPath = `/agent-teams/${team.id}/sessions/session-2`;
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: {
				agentTeams: {
					list: vi.fn(async () => ({ ...initial, teams: [team] })),
					listSessions: vi.fn(async () => [
						{
							id: "session-2",
							coordinationSessionPath: "C:/sessions/2.jsonl",
							title: "Second",
							createdAt: 2,
							updatedAt: 2,
						},
						{
							id: "session-1",
							coordinationSessionPath: "C:/sessions/1.jsonl",
							title: "First",
							createdAt: 1,
							updatedAt: 1,
						},
					]),
				},
			},
		});
	});

	it("renders Team sessions as navigable children and marks the deep-linked session active", async () => {
		render(<AgentTeamSidebarList />);

		const current = await screen.findByRole("button", { name: "Chat 2" });
		expect(current.dataset.active).toBe("true");
		const older = screen.getByRole("button", { name: "Chat 1" });
		fireEvent.click(older);

		await waitFor(() =>
			expect(router.navigate).toHaveBeenCalledWith({
				to: "/agent-teams/$teamId/sessions/$sessionId",
				params: expect.objectContaining({ sessionId: "session-1" }),
			}),
		);
	});
});
