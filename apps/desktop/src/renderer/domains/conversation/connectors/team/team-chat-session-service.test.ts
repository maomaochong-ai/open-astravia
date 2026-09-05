// @vitest-environment jsdom

import { createAgentTeamFixture, type TeamSessionSnapshot } from "@vetta/agent-team";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTeamChatSession, loadTeamChatSession } from "./team-chat-session-service";

const document = createAgentTeamFixture();
const team = document.teams[0];
if (!team) throw new Error("built-in Agent Team fixture is missing");

function snapshot(id: string, sessionPath: string): TeamSessionSnapshot {
	return {
		session: {
			schemaVersion: 1,
			revision: 0,
			id,
			teamId: team.id,
			name: team.name,
			cwd: "C:/workspace",
			leaderMemberId: team.leaderMemberId,
			memberHandles: Object.fromEntries(team.members.map((member) => [member.id, member.handle])),
			createdAt: 1,
			updatedAt: 1,
			events: [],
			coordinationRuntime: {
				sessionId: id,
				sessionPath,
			},
			memberRuntime: {},
		},
		conversationRevision: 0,
		messages: [],
		activities: [],
	};
}

describe("loadTeamChatSession", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.vetta = {
			agentTeams: {
				list: vi.fn(async () => document),
				listSessions: vi.fn(async () => []),
				getSession: vi.fn(),
				createSession: vi.fn(),
				createSessionRecord: vi.fn(),
			},
		} as unknown as typeof window.vetta;
	});

	it("upgrades a legacy id bookmark to the ordinary Conversation reference", async () => {
		const restored = snapshot("legacy-session", "C:/runtime/legacy-session.jsonl");
		vi.mocked(window.vetta.agentTeams.getSession).mockResolvedValue(restored);
		window.localStorage.setItem(`vetta.agent-team.session.${team.id}`, "legacy-session");

		await expect(loadTeamChatSession(team.id)).resolves.toEqual({
			document,
			snapshot: restored,
			sessions: [
				{
					id: "legacy-session",
					coordinationSessionPath: "C:/runtime/legacy-session.jsonl",
					title: team.name,
					createdAt: 1,
					updatedAt: 1,
				},
			],
		});
		expect(window.vetta.agentTeams.getSession).toHaveBeenCalledWith("legacy-session");
		expect(window.localStorage.getItem(`vetta.agent-team.session.${team.id}`)).toBe(
			JSON.stringify({ id: "legacy-session", coordinationSessionPath: "C:/runtime/legacy-session.jsonl" }),
		);
	});

	it("stores the ordinary Conversation reference for a newly created session", async () => {
		const created = snapshot("new-session", "C:/runtime/new-session.jsonl");
		vi.mocked(window.vetta.agentTeams.createSessionRecord).mockResolvedValue(created);

		await expect(loadTeamChatSession(team.id)).resolves.toEqual({
			document,
			snapshot: created,
			sessions: [
				{
					id: "new-session",
					coordinationSessionPath: "C:/runtime/new-session.jsonl",
					title: team.name,
					createdAt: 1,
					updatedAt: 1,
				},
			],
		});
		expect(window.vetta.agentTeams.createSessionRecord).toHaveBeenCalledWith(team.id);
		expect(window.vetta.agentTeams.createSession).not.toHaveBeenCalled();
		expect(window.localStorage.getItem(`vetta.agent-team.session.${team.id}`)).toBe(
			JSON.stringify({ id: "new-session", coordinationSessionPath: "C:/runtime/new-session.jsonl" }),
		);
	});

	it("deduplicates concurrent creation requests for the same Team", async () => {
		const created = snapshot("shared-session", "C:/runtime/shared-session.jsonl");
		vi.mocked(window.vetta.agentTeams.createSessionRecord).mockResolvedValue(created);

		const [first, second] = await Promise.all([
			createTeamChatSession(team.id, document, []),
			createTeamChatSession(team.id, document, []),
		]);

		expect(first.snapshot.session.id).toBe("shared-session");
		expect(second.snapshot.session.id).toBe("shared-session");
		expect(window.vetta.agentTeams.createSessionRecord).toHaveBeenCalledTimes(1);
	});

	it("opens a selected catalog session without creating another one", async () => {
		const older = snapshot("older", "C:/runtime/older.jsonl");
		vi.mocked(window.vetta.agentTeams.listSessions).mockResolvedValue([
			{
				id: "older",
				coordinationSessionPath: "C:/runtime/older.jsonl",
				title: team.name,
				createdAt: 1,
				updatedAt: 2,
			},
		]);
		vi.mocked(window.vetta.agentTeams.getSession).mockResolvedValue(older);

		const loaded = await loadTeamChatSession(team.id, "older");

		expect(loaded.snapshot.session.id).toBe("older");
		expect(window.vetta.agentTeams.getSession).toHaveBeenCalledWith({
			id: "older",
			coordinationSessionPath: "C:/runtime/older.jsonl",
		});
		expect(window.vetta.agentTeams.createSession).not.toHaveBeenCalled();
	});

	it("rejects an unknown deep-linked session instead of silently creating a replacement", async () => {
		await expect(loadTeamChatSession(team.id, "missing")).rejects.toThrow("Agent Team session not found: missing");
		expect(window.vetta.agentTeams.createSession).not.toHaveBeenCalled();
	});

	it("falls back from a stale bookmark to the newest catalog session", async () => {
		const current = snapshot("current", "C:/runtime/current.jsonl");
		window.localStorage.setItem(`vetta.agent-team.session.${team.id}`, "stale");
		vi.mocked(window.vetta.agentTeams.listSessions).mockResolvedValue([
			{
				id: "current",
				coordinationSessionPath: "C:/runtime/current.jsonl",
				title: team.name,
				createdAt: 1,
				updatedAt: 2,
			},
		]);
		vi.mocked(window.vetta.agentTeams.getSession)
			.mockRejectedValueOnce(new Error("missing"))
			.mockResolvedValueOnce(current);

		const loaded = await loadTeamChatSession(team.id);

		expect(loaded.snapshot.session.id).toBe("current");
		expect(window.vetta.agentTeams.createSession).not.toHaveBeenCalled();
	});
});
