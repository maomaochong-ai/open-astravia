import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

import type { TeamSessionDocument } from "@vetta/agent-team";
import { createTeamSessionRepository } from "./team-session-repository.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

describe("createTeamSessionRepository", () => {
	it("stores only Team coordination metadata while Conversation paths stay runtime-owned", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-team-session-"));
		temporaryDirectories.push(root);
		const repository = createTeamSessionRepository(root);
		const session: TeamSessionDocument = {
			schemaVersion: 1,
			revision: 0,
			id: "session",
			teamId: "team",
			name: "Team",
			cwd: "C:/workspace",
			leaderMemberId: "leader",
			activeMemberIds: ["leader"],
			memberHandles: { leader: "leader" },
			createdAt: 1,
			updatedAt: 1,
			coordinationRuntime: { sessionId: "coordination", sessionPath: "C:/conversations/coordination.jsonl" },
			events: [],
			memberRuntime: {
				leader: {
					sessionId: "leader-conversation",
					sessionPath: "C:/conversations/leader.jsonl",
					agentProfileRevision: 1,
					deliveredEventIds: [],
				},
			},
		};

		await repository.write(session);

		await expect(repository.read(session.id)).resolves.toEqual(session);
		expect("memberSessionDirectory" in repository).toBe(false);
	});
});
