import { describe, expect, it } from "vitest";
import { snapshot } from "./support/builders.js";
import { createFixture } from "./support/fixture.js";

describe("SubagentCoordinator recovery", () => {
	it("restores terminal entries and deterministically normalizes abandoned work", async () => {
		const fixture = createFixture({ now: 500 });
		fixture.coordinator.restore({
			agents: [
				snapshot("completed", "completed", { generation: 2, sessionFile: "completed.conversation.jsonl" }),
				snapshot("running", "running", { generation: 4, sessionFile: "running.conversation.jsonl" }),
				snapshot("queued", "queued"),
			],
			delivered: [{ id: "completed", generation: 2 }],
		});

		expect(fixture.coordinator.get("completed")).toMatchObject({
			status: "completed",
			generation: 2,
		});
		expect(fixture.coordinator.get("running")).toMatchObject({
			status: "interrupted",
			generation: 5,
			endedAt: 500,
			errorMessage: "Parent runtime restarted while the subagent was active",
		});
		expect(fixture.coordinator.get("queued")).toMatchObject({
			status: "failed",
			generation: 1,
			endedAt: 500,
			errorMessage: "Parent runtime restarted before the child session was created",
		});
		expect((await fixture.coordinator.wait({ targets: ["completed"] })).agents).toEqual([]);
		expect((await fixture.coordinator.wait({ targets: ["running"] })).agents).toEqual([
			expect.objectContaining({ id: "running", status: "interrupted", generation: 5 }),
		]);
	});

	it("lazily reopens a recovered child for follow-up", async () => {
		const fixture = createFixture({ reopen: true });
		fixture.coordinator.restore({
			agents: [snapshot("recovered", "interrupted", { generation: 1, sessionFile: "recovered.conversation.jsonl" })],
			delivered: [],
		});

		const resumed = await fixture.coordinator.followUp("recovered", "continue the task");

		expect(resumed).toMatchObject({ id: "recovered", status: "running", task: "continue the task" });
		expect(fixture.children).toHaveLength(1);
		expect(fixture.children[0]?.prompts).toEqual(["continue the task"]);
	});

	it("marks a recovered child failed when its transcript cannot be reopened", async () => {
		const fixture = createFixture({ reopenError: new Error("transcript missing") });
		fixture.coordinator.restore({
			agents: [snapshot("missing", "interrupted", { generation: 1, sessionFile: "missing.conversation.jsonl" })],
			delivered: [],
		});

		await expect(fixture.coordinator.followUp("missing", "continue")).rejects.toThrow("transcript missing");
		expect(fixture.coordinator.get("missing")).toMatchObject({
			status: "failed",
			generation: 2,
			errorMessage: "Unable to reopen subagent: transcript missing",
		});
	});

	it("rejects an ambiguous recovered registry before mutating the coordinator", () => {
		const fixture = createFixture();

		expect(() =>
			fixture.coordinator.restore({
				agents: [snapshot("first", "completed"), { ...snapshot("second", "completed"), taskName: "first" }],
				delivered: [],
			}),
		).toThrow('Duplicate recovered subagent task_name "first"');
		expect(fixture.coordinator.list()).toEqual([]);
	});
});
