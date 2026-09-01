import { describe, expect, it } from "vitest";
import { runPeerAgentsExample } from "../../examples/multi-agent/01-peer-agents.js";
import { runRevisionRolloutExample } from "../../examples/multi-agent/02-revision-rollout.js";

describe("Runtime Core multi-Agent examples", () => {
	it("runs peer Agents with isolated definitions, instances and sessions", async () => {
		const result = await runPeerAgentsExample();

		expect(result.writer).toEqual({
			instruction: "Draft a concise implementation plan.",
			stablePromptLength: "Draft a concise implementation plan.".length,
		});
		expect(result.reviewer).toEqual({
			instruction: "Review the plan and report concrete risks.",
			stablePromptLength: "Review the plan and report concrete risks.".length,
		});
		expect(result.instances).toEqual([
			{
				id: "reviewer-instance",
				agentId: "reviewer",
				sessionIds: ["reviewer-session"],
			},
			{
				id: "writer-instance",
				agentId: "writer",
				sessionIds: ["writer-session"],
			},
		]);
	});

	it("keeps old generations pinned and rolls a Session over at the next Turn boundary", async () => {
		const result = await runRevisionRolloutExample();
		const oldRevisionId = result.beforeUpdate.revisionId;
		const newRevisionId = result.newInstanceAfterUpdate.revisionId;

		expect(oldRevisionId).not.toBe("");
		expect(newRevisionId).not.toBe(oldRevisionId);
		expect(result.beforeUpdate).toEqual({ revisionId: oldRevisionId, instruction: "Review with policy v1." });
		expect(result.pinnedInstanceAfterUpdate).toEqual({
			revisionId: oldRevisionId,
			instruction: "Review with policy v1.",
		});
		expect(result.newInstanceAfterUpdate).toEqual({
			revisionId: newRevisionId,
			instruction: "Review with policy v2.",
		});
		expect(result.rollout).toEqual({ status: "applied", revisionId: newRevisionId });
		expect(result.inFlightAfterRollout).toEqual({
			revisionId: oldRevisionId,
			instruction: "Review with policy v1.",
		});
		expect(result.nextTurnAfterRollout).toEqual({
			revisionId: newRevisionId,
			instruction: "Review with policy v2.",
		});
	});
});
