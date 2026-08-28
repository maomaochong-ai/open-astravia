import type { SubagentSnapshot } from "@vetta/runtime-subagents";
import { describe, expect, it } from "vitest";
import {
	CodingAgentSubagentTodoProjection,
	toSubagentSnapshot,
} from "../../src/composition/subagent/todo-progress-projection.js";
import type { CodingAgentSubagentSnapshot } from "../../src/runtime-contracts/index.js";

describe("CodingAgentSubagentTodoProjection", () => {
	it("owns workflow Todo initialization and projects progress without changing Runtime snapshots", () => {
		const projection = new CodingAgentSubagentTodoProjection();
		projection.seed([
			{
				taskName: "inspect_repo",
				message: "Inspect repository",
				agentType: "workflow",
				todos: ["Read boundaries", "Report findings"],
			},
		]);

		expect(projection.readInitialItems("inspect_repo")).toEqual(["Read boundaries", "Report findings"]);
		expect(projection.project(snapshot("queued-id"))).toMatchObject({
			id: "queued-id",
			todoProgress: { done: 0, total: 2 },
		});

		expect(projection.update("inspect_repo", [{ status: "done" }, { status: "in_progress" }])).toBe(true);
		expect(projection.project(snapshot("child-id"))).toMatchObject({
			id: "child-id",
			todoProgress: { done: 1, total: 2 },
		});
		expect(toSubagentSnapshot(projection.project(snapshot("child-id")))).not.toHaveProperty("todoProgress");
	});

	it("restores compatible product snapshots and prunes state with finished Runtime tasks", () => {
		const projection = new CodingAgentSubagentTodoProjection();
		const recovered: CodingAgentSubagentSnapshot = {
			...snapshot("child-id"),
			todoProgress: { done: 2, total: 3 },
		};
		projection.restore(recovered);

		expect(projection.project(snapshot("reopened-id")).todoProgress).toEqual({ done: 2, total: 3 });
		projection.prune([]);
		expect(projection.project(snapshot("reopened-id"))).not.toHaveProperty("todoProgress");
	});

	it("rolls back provisional dispatch state when Runtime validation rejects the batch", () => {
		const projection = new CodingAgentSubagentTodoProjection();
		projection.restore({ ...snapshot("existing"), todoProgress: { done: 1, total: 1 } });
		const seed = projection.seed([
			{
				taskName: "inspect_repo",
				message: "Invalid replacement",
				agentType: "unknown",
				todos: ["Provisional"],
			},
		]);

		projection.rollback(seed);

		expect(projection.project(snapshot("existing")).todoProgress).toEqual({ done: 1, total: 1 });
		expect(projection.readInitialItems("inspect_repo")).toBeUndefined();
	});
});

function snapshot(id: string): SubagentSnapshot {
	return {
		id,
		taskName: "inspect_repo",
		path: "/root/inspect_repo",
		agentType: "workflow",
		status: "running",
		task: "Inspect repository",
		parentSessionId: "parent",
		startedAt: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 },
		generation: 0,
	};
}
