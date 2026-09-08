import {
	AGENT_TEAM_SCHEMA_VERSION,
	type AgentTeamExtensionRegistry,
	type TeamMemberTurnAttempt,
	type TeamSessionDocument,
	type TeamWorkItem,
} from "@vetta/agent-team";
import type { RuntimeHost } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import type { TeamCollaborationStore } from "./team-collaboration-store.js";
import type { TeamSessionEventHub } from "./team-session-event-hub.js";
import type { TeamSessionStateRepository } from "./team-session-state-repository.js";
import { TeamTurnCoordinator } from "./team-turn-coordinator.js";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("TeamTurnCoordinator", () => {
	it("does not wake a task initiator after the user stopped the team", async () => {
		const deliverSessionContext = vi.fn(async () => undefined);
		const runtime = {
			deliverSessionContext,
			readSessionDocument: () => ({ entries: [] }),
		} as unknown as RuntimeHost;
		const completedWorkItem: TeamWorkItem = {
			id: "work-1",
			requestTurnId: "request-1",
			createdByParticipantId: "leader",
			assignedToParticipantId: "member",
			objective: "complete work",
			contextEntryIds: [],
			state: "completed",
			resultMessageId: "result-1",
			currentAttemptId: "attempt-1",
			createdAt: 1,
			updatedAt: 2,
			revision: 2,
		};
		const collaborationStore = {
			settle: vi.fn(async () => completedWorkItem),
		} as unknown as TeamCollaborationStore;
		const sessionState = {
			get: () => undefined,
		} as unknown as TeamSessionStateRepository;
		const coordinator = new TeamTurnCoordinator({
			runtime: () => runtime,
			extensions: {} as AgentTeamExtensionRegistry,
			collaborationStore,
			sessionState,
			eventHub: {} as TeamSessionEventHub,
			readSession: async () => session,
			readDocument: async () => ({
				schemaVersion: AGENT_TEAM_SCHEMA_VERSION,
				revision: 0,
				agents: [],
				teams: [],
			}),
			observations: () => undefined,
			publishSessionUpdated: () => undefined,
		});

		await coordinator.abort(session.id);
		await coordinator.settleMemberAttempt(
			session,
			{ ...completedWorkItem, state: "running", resultMessageId: undefined, revision: 1 },
			attempt,
			{ state: "completed" },
			"result-1",
		);

		expect(deliverSessionContext).not.toHaveBeenCalled();
	});
});

const session: TeamSessionDocument = {
	schemaVersion: AGENT_TEAM_SCHEMA_VERSION,
	revision: 1,
	id: "team-session",
	teamId: "team",
	name: "Team",
	cwd: "C:/workspace",
	leaderMemberId: "leader",
	memberHandles: { leader: "leader", member: "member" },
	createdAt: 1,
	updatedAt: 1,
	coordinationRuntime: { sessionId: "coordination", sessionPath: "C:/coordination.jsonl" },
	events: [],
	memberRuntime: {
		leader: {
			sessionId: "leader-runtime",
			sessionPath: "C:/leader.jsonl",
			agentProfileRevision: 1,
			deliveredEventIds: [],
		},
	},
};

const attempt: TeamMemberTurnAttempt = {
	id: "attempt-1",
	workItemId: "work-1",
	participantConversationId: "member-runtime",
	sourceTurnId: "member-turn",
	attempt: 1,
	mode: "initial",
	state: "running",
	lastProgressAt: 1,
};
