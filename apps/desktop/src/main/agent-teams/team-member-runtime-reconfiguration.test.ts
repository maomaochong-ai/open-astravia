import type { TeamSessionDocument } from "@vetta/agent-team";
import type { SessionConfig } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import {
	reconfigureTeamMemberRuntime,
	type TeamMemberRuntimeReconfigurationHost,
} from "./team-member-runtime-reconfiguration.js";

function sessionDocument(): TeamSessionDocument {
	return {
		schemaVersion: 1,
		revision: 2,
		id: "team-session",
		teamId: "team",
		name: "Team",
		cwd: "C:/workspace",
		leaderMemberId: "leader",
		memberHandles: { leader: "leader" },
		createdAt: 1,
		updatedAt: 1,
		events: [],
		memberRuntime: {
			leader: {
				sessionId: "old-runtime",
				sessionPath: "C:/sessions/leader.jsonl",
				agentProfileId: "agent",
				agentProfileRevision: 1,
				deliveredEventIds: [],
			},
		},
	};
}

const logger = { info: vi.fn(), error: vi.fn() };

describe("reconfigureTeamMemberRuntime", () => {
	it("reopens the same history with the latest profile revision and persists the new binding", async () => {
		const paths = new Map([["old-runtime", "C:/sessions/leader.jsonl"]]);
		const calls: string[] = [];
		const runtime: TeamMemberRuntimeReconfigurationHost = {
			getSessionPath: (sessionId) => paths.get(sessionId),
			disposeSession: vi.fn(async (sessionId) => {
				calls.push(`dispose:${sessionId}`);
				paths.delete(sessionId);
			}),
			createSession: vi.fn(async (config) => {
				calls.push(`create:${config.sessionPath}`);
				paths.set("new-runtime", String(config.sessionPath));
				return { sessionId: "new-runtime" };
			}),
		};
		const persist = vi.fn(async () => undefined);
		const resolveConfig = vi.fn(
			async (sessionPath) => ({ cwd: "C:/workspace", sessionPath }) satisfies SessionConfig,
		);

		const next = await reconfigureTeamMemberRuntime({
			session: sessionDocument(),
			memberId: "leader",
			agentProfileId: "agent",
			agentProfileRevision: 3,
			runtime,
			resolveConfig,
			persist,
			now: () => 20,
			logger,
		});

		expect(calls).toEqual(["dispose:old-runtime", "create:C:/sessions/leader.jsonl"]);
		expect(next.memberRuntime.leader).toMatchObject({
			sessionId: "new-runtime",
			agentProfileRevision: 3,
		});
		expect(next).toMatchObject({ revision: 3, updatedAt: 20 });
		expect(persist).toHaveBeenCalledWith(next);
	});

	it("does nothing when the live runtime already uses the current profile revision", async () => {
		const session = sessionDocument();
		const runtime: TeamMemberRuntimeReconfigurationHost = {
			getSessionPath: vi.fn(),
			createSession: vi.fn(),
			disposeSession: vi.fn(),
		};

		await expect(
			reconfigureTeamMemberRuntime({
				session,
				memberId: "leader",
				agentProfileId: "agent",
				agentProfileRevision: 1,
				runtime,
				resolveConfig: vi.fn(),
				persist: vi.fn(),
				logger,
			}),
		).resolves.toBe(session);
		expect(runtime.createSession).not.toHaveBeenCalled();
	});
});
