import { describe, expect, it } from "vitest";
import {
	buildTeamRosterSnapshot,
	classifyTeamAttemptTerminal,
	classifyTeamExecutionIssue,
	filterTeamMemberActiveToolNames,
	isTeamMessageDelivery,
	matchesTeamExternalConditionChange,
	type TeamExecutionIssue,
	type TeamWorkItem,
	transitionTeamMessageDelivery,
	transitionTeamWorkItem,
} from "../src/collaboration.js";
import type { AgentProfile, TeamDefinition } from "../src/contracts.js";
import { isDefaultTeamTaskActionAllowed } from "../src/task-control.js";

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
	it("keeps default task ownership with the leader while allowing an assignee to resume itself", () => {
		expect(
			isDefaultTeamTaskActionAllowed({
				action: "delegate",
				leaderMemberId: "leader",
				sourceMemberId: "leader",
				targetMemberId: "member",
			}),
		).toBe(true);
		expect(
			isDefaultTeamTaskActionAllowed({
				action: "delegate",
				leaderMemberId: "leader",
				sourceMemberId: "member",
				targetMemberId: "leader",
			}),
		).toBe(false);
		expect(
			isDefaultTeamTaskActionAllowed({
				action: "cancel",
				leaderMemberId: "leader",
				sourceMemberId: "member",
				targetMemberId: "member",
			}),
		).toBe(false);
		expect(
			isDefaultTeamTaskActionAllowed({
				action: "resume",
				leaderMemberId: "leader",
				sourceMemberId: "member",
				targetMemberId: "member",
			}),
		).toBe(true);
		expect(
			isDefaultTeamTaskActionAllowed({
				action: "resume",
				leaderMemberId: "leader",
				sourceMemberId: "other",
				targetMemberId: "member",
			}),
		).toBe(false);
	});

	it("enforces independent delivery terminal states", () => {
		const delivery = {
			id: "delivery",
			messageId: "message",
			fromParticipantId: "leader",
			toParticipantId: "member",
			intent: "question" as const,
			state: "pending" as const,
			createdAt: 1,
			updatedAt: 1,
		};
		expect(isTeamMessageDelivery(delivery)).toBe(true);
		const waiting = transitionTeamMessageDelivery(delivery, { state: "waiting", updatedAt: 2 });
		expect(
			transitionTeamMessageDelivery(waiting, { state: "responded", replyMessageId: "reply", updatedAt: 3 }),
		).toMatchObject({ state: "responded", replyMessageId: "reply" });
		expect(() =>
			transitionTeamMessageDelivery(delivery, { state: "responded", replyMessageId: "reply", updatedAt: 2 }),
		).toThrow("pending -> responded");
		expect(() => transitionTeamMessageDelivery(waiting, { state: "responded", updatedAt: 3 })).toThrow(
			"requires a reply",
		);
	});
	it("removes private subagent controls from the default Team member tool surface", () => {
		expect(filterTeamMemberActiveToolNames(["read", "spawn_agent", "team_delegate_task", "wait_agent"])).toEqual([
			"read",
			"team_delegate_task",
		]);
	});
	it("keeps billing and network failures recoverable without calling them Agent failures", () => {
		expect(
			classifyTeamExecutionIssue({
				code: "insufficient_credit",
				message: "billing",
				retryable: false,
				origin: "provider",
				details: { provider: "openai", modelId: "gpt-5" },
			}),
		).toMatchObject({
			category: "insufficient-credit",
			retryability: "after-external-change",
			provider: "openai",
			modelId: "gpt-5",
		});
		expect(
			classifyTeamExecutionIssue({
				code: "NETWORK_TIMEOUT",
				message: "timeout",
				retryable: true,
				origin: "provider",
			}),
		).toMatchObject({ category: "network", retryability: "automatic" });
	});
	it("matches external changes by retry policy and the available provider identity", () => {
		const issue: TeamExecutionIssue = {
			category: "authentication",
			retryability: "after-external-change",
			code: "unauthorized",
			provider: "openai",
			modelId: "gpt-5",
		};
		expect(matchesTeamExternalConditionChange(issue, { category: "authentication", provider: "openai" })).toBe(true);
		expect(matchesTeamExternalConditionChange(issue, { category: "authentication", provider: "anthropic" })).toBe(
			false,
		);
		expect(matchesTeamExternalConditionChange(issue, { category: "insufficient-credit", provider: "openai" })).toBe(
			false,
		);
		expect(
			matchesTeamExternalConditionChange(
				{ category: "network", retryability: "automatic", code: "timeout" },
				{ category: "authentication" },
			),
		).toBe(false);
		// Legacy records did not persist provider/model identity. A category-scoped host
		// signal remains a valid, conservative wake-up for those records.
		expect(
			matchesTeamExternalConditionChange(
				{ category: "authentication", retryability: "after-external-change", code: "unauthorized" },
				{ category: "authentication", provider: "openai" },
			),
		).toBe(true);
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
