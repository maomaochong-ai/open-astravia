// @vitest-environment jsdom

import { createAgentTeamFixture } from "@vetta/agent-team";
import { notifyTeamSessionsChanged } from "@shared/agent-teams/team-session-events";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTeamSidebarList } from "./AgentTeamSidebarList";

const router = vi.hoisted(() => ({
	currentPath: "/agent-teams/team/sessions/session-2",
	navigate: vi.fn(),
}));
const teamFixture = createAgentTeamFixture().teams[0];
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
vi.mock("@shared/agent-teams/agent-team-presentation", () => ({
	teamDisplayName: (team: { name: string }) => team.name,
}));

afterEach(cleanup);

describe("AgentTeamSidebarList", () => {
	beforeEach(() => {
		router.navigate.mockReset();
		const initial = createAgentTeamFixture();
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

	it("shows the new session route before runtime-backed creation starts", async () => {
		const { rerender } = render(<AgentTeamSidebarList />);

		const createButton = await screen.findByRole("button", { name: "New chat" });
		// 操作按钮由包含行的上下边界和 auto margin 居中，不再依赖 transform。
		// 通用 Button 自带按下态 transform，不能再与行居中 transform 叠加。
		expect(createButton.className).toContain("inset-y-0");
		expect(createButton.className).toContain("my-auto");
		expect(createButton.className).not.toContain("top-1/2");
		fireEvent.click(createButton);

		expect(window.vetta.agentTeams.createSession).not.toHaveBeenCalled();
		expect(router.navigate).toHaveBeenCalledWith({
			to: "/agent-teams/$teamId/new",
			params: { teamId: teamFixture.id },
		});

		router.currentPath = `/agent-teams/${teamFixture.id}/new`;
		rerender(<AgentTeamSidebarList />);
		const newSessionRows = await screen.findAllByRole("button", { name: "New chat" });
		expect(newSessionRows.some((row) => row.dataset.sessionActive === "true")).toBe(true);
	});

	it("limits the Team avatar stack and shows an overflow marker", async () => {
		render(<AgentTeamSidebarList />);

		await screen.findByText("Vetta Team");
		expect(document.querySelectorAll("img")).toHaveLength(3);
		expect(document.querySelector('[data-session-avatar-overflow="1"]')).toBeTruthy();
	});

	it("refreshes only the changed Team session catalog", async () => {
		render(<AgentTeamSidebarList />);
		await screen.findByText("Vetta Team");
		const list = vi.mocked(window.vetta.agentTeams.list);
		const listSessions = vi.mocked(window.vetta.agentTeams.listSessions);

		notifyTeamSessionsChanged(teamFixture.id);
		await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
		expect(list).toHaveBeenCalledTimes(1);
		expect(listSessions).toHaveBeenLastCalledWith(teamFixture.id);
	});
});
