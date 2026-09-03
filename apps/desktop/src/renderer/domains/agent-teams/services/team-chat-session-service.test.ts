// @vitest-environment jsdom

import { createInitialAgentTeamDocument, type TeamSessionSnapshot } from "@vetta/agent-team";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTeamChatSession } from "./team-chat-session-service";

const document = createInitialAgentTeamDocument();
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
				getSession: vi.fn(),
				createSession: vi.fn(),
			},
			config: {
				get: vi.fn(async () => ({ defaultConversationCwd: "C:/workspace" })),
			},
		} as unknown as typeof window.vetta;
	});

	it("upgrades a legacy id bookmark to the ordinary Conversation reference", async () => {
		const restored = snapshot("legacy-session", "C:/runtime/legacy-session.jsonl");
		vi.mocked(window.vetta.agentTeams.getSession).mockResolvedValue(restored);
		window.localStorage.setItem(`vetta.agent-team.session.${team.id}`, "legacy-session");

		await expect(loadTeamChatSession(team.id)).resolves.toEqual({ document, snapshot: restored });
		expect(window.vetta.agentTeams.getSession).toHaveBeenCalledWith("legacy-session");
		expect(window.localStorage.getItem(`vetta.agent-team.session.${team.id}`)).toBe(
			JSON.stringify({ id: "legacy-session", coordinationSessionPath: "C:/runtime/legacy-session.jsonl" }),
		);
	});

	it("stores the ordinary Conversation reference for a newly created session", async () => {
		const created = snapshot("new-session", "C:/runtime/new-session.jsonl");
		vi.mocked(window.vetta.agentTeams.createSession).mockResolvedValue(created);

		await expect(loadTeamChatSession(team.id)).resolves.toEqual({ document, snapshot: created });
		expect(window.vetta.agentTeams.createSession).toHaveBeenCalledWith(team.id, "C:/workspace");
		expect(window.localStorage.getItem(`vetta.agent-team.session.${team.id}`)).toBe(
			JSON.stringify({ id: "new-session", coordinationSessionPath: "C:/runtime/new-session.jsonl" }),
		);
	});
});
