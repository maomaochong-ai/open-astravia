import { describe, expect, it } from "vitest";
import { appendCompactionWorkState } from "../src/compaction/work-state-recovery.js";

describe("compaction work state recovery", () => {
	it("appends Todo-derived plan state and recoverable background task references", () => {
		const summary = appendCompactionWorkState("summary", {
			todos: [
				{ id: 1, content: "done", status: "done" },
				{ id: 2, content: "continue implementation", status: "in_progress" },
				{ id: 3, content: "run checks", status: "pending" },
			],
			backgroundTasks: [
				{
					id: "task-1",
					command: "bunx vitest --run",
					status: "running",
					outputFile: "C:/tmp/task-1.log",
				},
			],
		});

		const state = parseState(summary);
		expect(state.plan).toEqual({ status: "active", completed: 1, total: 3, nextTodoId: 2 });
		expect(state.todos).toHaveLength(3);
		expect(state.backgroundTasks).toEqual([
			expect.objectContaining({ id: "task-1", status: "running", outputFile: "C:/tmp/task-1.log" }),
		]);
	});

	it("replaces an older recovery block instead of accumulating stale state", () => {
		const first = appendCompactionWorkState("summary", {
			todos: [{ id: 1, content: "old", status: "pending" }],
			backgroundTasks: [],
		});
		const second = appendCompactionWorkState(first, {
			todos: [{ id: 1, content: "old", status: "done" }],
			backgroundTasks: [],
		});

		expect(second.match(/<runtime-work-state>/g)).toHaveLength(1);
		expect(parseState(second).plan).toEqual({ status: "completed", completed: 1, total: 1 });
	});

	it("removes an obsolete block when there is no remaining work state", () => {
		const previous = appendCompactionWorkState("summary", {
			todos: [{ id: 1, content: "old", status: "pending" }],
			backgroundTasks: [],
		});

		expect(appendCompactionWorkState(previous, { todos: [], backgroundTasks: [] })).toBe("summary");
	});
});

function parseState(summary: string): {
	readonly plan: unknown;
	readonly todos: readonly unknown[];
	readonly backgroundTasks: readonly unknown[];
} {
	const match = summary.match(/<runtime-work-state>\n([\s\S]+)\n<\/runtime-work-state>/);
	if (!match?.[1]) throw new Error("Missing runtime work state");
	return JSON.parse(match[1]);
}
