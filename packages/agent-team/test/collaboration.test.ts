import { describe, expect, it } from "vitest";
import {
	buildTeamRosterSnapshot,
	classifyTeamAttemptTerminal,
	classifyTeamExecutionIssue,
	filterTeamMemberActiveToolNames,
	type TeamExecutionIssue,
	type TeamWorkItem,
	transitionTeamWorkItem,
} from "../src/collaboration.js";
import type { AgentProfile, TeamDefinition } from "../src/contracts.js";

const profile: AgentProfile = {
	id: "profile-builder",
	revision: 3,
	name: "Builder",
	description: "Implements maintainable changes.",
	mentionHandle: "builder",
	blueprintId: "builder",
	abilities: { selectionMode: "custom", skills: [], mcpServers: [], plugins: [] },
	scope: { kind: "library" },
	createdAt: 1,
	updatedAt: 2,
};
const team: TeamDefinition = {
	id: "team",
	revision: 4,
	name: "Product Team",
	description: "",
	leaderMemberId: "builder-member",
	members: [
		{
			id: "builder-member",
			handle: "builder",
			binding: { kind: "reference", agentProfileId: profile.id },
		},
	],
	orchestrationPolicyId: "leader-delegates-v1",
	contextPolicyId: "public-results-v1",
	createdAt: 1,
	updatedAt: 2,
};

function workItem(state: TeamWorkItem["state"] = "queued"): TeamWorkItem {
	return {
		id: "task",
		requestTurnId: "request",
		createdByParticipantId: "leader",
		assignedToParticipantId: "builder-member",
		objective: "Implement it",
		contextEntryIds: [],
		state,
		createdAt: 1,
		updatedAt: 1,
		revision: 1,
	};
}

describe("Agent Team collaboration contracts", () => {
	it("removes private subagent controls from the default Team member tool surface", () => {
		expect(filterTeamMemberActiveToolNames(["read", "spawn_agent", "team_delegate", "wait_agent"])).toEqual([
			"read",
			"team_delegate",
		]);
	});
	it("keeps billing and network failures recoverable without calling them Agent failures", () => {
		expect(
			classifyTeamExecutionIssue({
				code: "insufficient_credit",
				message: "billing",
				retryable: false,
				origin: "provider",
			}),
		).toMatchObject({ category: "insufficient-credit", retryability: "after-external-change" });
		expect(
			classifyTeamExecutionIssue({
				code: "NETWORK_TIMEOUT",
				message: "timeout",
				retryable: true,
				origin: "provider",
			}),
		).toMatchObject({ category: "network", retryability: "automatic" });
	});
	it("builds a roster from stable profiles and resolved runtime capabilities", () => {
		const snapshot = buildTeamRosterSnapshot({ agents: [profile] }, team, {
			capabilitiesByParticipantId: {
				"builder-member": [{ kind: "tool", id: "edit", label: "Edit files" }],
			},
			availabilityByParticipantId: { "builder-member": "running" },
		});

		expect(snapshot).toEqual({
			teamId: "team",
			teamName: "Product Team",
			teamRevision: 4,
			leaderParticipantId: "builder-member",
			members: [
				{
					participantId: "builder-member",
					handle: "builder",
					displayName: "Builder",
					isLeader: true,
					role: "builder",
					responsibilitySummary: "Implements maintainable changes.",
					capabilities: [{ kind: "tool", id: "edit", label: "Edit files" }],
					availability: "running",
					profileRevision: 3,
				},
			],
		});
	});

	it("requires a result message when a work item completes", () => {
		expect(() => transitionTeamWorkItem(workItem("running"), { state: "completed", updatedAt: 2 })).toThrow(
			"requires a result message",
		);
		const completed = transitionTeamWorkItem(workItem("running"), {
			state: "completed",
			updatedAt: 2,
			resultMessageId: "message",
		});
		expect(completed).toMatchObject({ state: "completed", revision: 2, resultMessageId: "message" });
	});

	it("rejects transitions out of terminal states", () => {
		expect(() => transitionTeamWorkItem(workItem("completed"), { state: "running", updatedAt: 2 })).toThrow(
			"completed -> running",
		);
	});

	it.each<{
		name: string;
		issue?: TeamExecutionIssue;
		hasPublishableMessage?: boolean;
		cancelled?: boolean;
		state: ReturnType<typeof classifyTeamAttemptTerminal>["state"];
	}>([
		{ name: "published result", hasPublishableMessage: true, state: "completed" },
		{ name: "missing terminal message", state: "interrupted" },
		{
			name: "network error",
			issue: { category: "network", retryability: "automatic", code: "network" },
			state: "waiting-retry",
		},
		{
			name: "insufficient credit",
			issue: {
				category: "insufficient-credit",
				retryability: "after-external-change",
				code: "credit",
			},
			state: "awaiting-resource",
		},
		{
			name: "invalid request",
			issue: { category: "invalid-request", retryability: "never", code: "invalid" },
			state: "non-retryable-failure",
		},
		{ name: "cancelled", cancelled: true, state: "cancelled" },
	])("classifies $name without treating every terminal as failure", (fixture) => {
		expect(
			classifyTeamAttemptTerminal({
				hasPublishableMessage: fixture.hasPublishableMessage ?? false,
				cancelled: fixture.cancelled ?? false,
				...(fixture.issue ? { issue: fixture.issue } : {}),
			}).state,
		).toBe(fixture.state);
	});
});
