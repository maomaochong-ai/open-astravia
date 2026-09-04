// @vitest-environment jsdom

import { createInitialAgentTeamDocument, type TeamSessionSnapshot } from "@vetta/agent-team";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTeamSidebarList } from "./AgentTeamSidebarList";

const router = vi.hoisted(() => ({
	currentPath: "/agent-teams/team/sessions/session-2",
	navigate: vi.fn(),
}));
const teamFixture = createInitialAgentTeamDocument().teams[0];
if (!teamFixture) throw new Error("missing Team fixture");

vi.mock("@tanstack/react-router", () => ({
	useMatches: () => [{ pathname: router.currentPath }],
	useNavigate: () => router.navigate,
}));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, number>) =>
			key === "chat.sessionLabel"
				? `Chat ${values?.index ?? ""}`
				: key === "chat.newSession"
					? "New chat"
					: key,
	}),
}));
vi.mock("@shared/agent-teams/preset-presentation", () => ({
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
					createSession: vi.fn(),
				},
			},
		});
	});

	it("renders Team sessions as navigable children and marks the deep-linked session active", async () => {
		render(<AgentTeamSidebarList />);

		const current = await screen.findByRole("button", { name: "Chat 2" });
		expect(current.dataset.sessionActive).toBe("true");
		const older = screen.getByRole("button", { name: "Chat 1" });
		fireEvent.click(older);

		await waitFor(() =>
			expect(router.navigate).toHaveBeenCalledWith({
				to: "/agent-teams/$teamId/sessions/$sessionId",
				params: expect.objectContaining({ sessionId: "session-1" }),
			}),
		);
	});

	it("creates a session from the Team row action and navigates to it", async () => {
		const created = { session: { id: "new-session" } } as TeamSessionSnapshot;
		vi.mocked(window.vetta.agentTeams.createSession).mockResolvedValue(created);
		render(<AgentTeamSidebarList />);

		const createButton = await screen.findByRole("button", { name: "New chat" });
		fireEvent.click(createButton);

		await waitFor(() => {
			expect(window.vetta.agentTeams.createSession).toHaveBeenCalledWith(teamFixture.id);
			expect(router.navigate).toHaveBeenCalledWith({
				to: "/agent-teams/$teamId/sessions/$sessionId",
				params: { teamId: teamFixture.id, sessionId: "new-session" },
			});
		});
	});

	it("limits the Team avatar stack and shows an overflow marker", async () => {
		render(<AgentTeamSidebarList />);

		await screen.findByText("Vetta Team");
		expect(document.querySelectorAll("img")).toHaveLength(3);
		expect(screen.getByText("…")).toBeTruthy();
	});
});
