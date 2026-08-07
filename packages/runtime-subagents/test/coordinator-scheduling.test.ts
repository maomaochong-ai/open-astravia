import { describe, expect, it } from "vitest";
import { request, snapshot } from "./support/builders.js";
import { createFixture } from "./support/fixture.js";
import { DelayedAbortChild, TestChild } from "./support/test-child.js";
import { delay, waitUntil } from "./support/wait.js";

describe("SubagentCoordinator scheduling", () => {
	it("queues overflow in FIFO order and refills the active slot", async () => {
		const fixture = createFixture({ maxConcurrent: 1 });
		const snapshots = fixture.coordinator.spawnMany([request("first"), request("second"), request("third")]);

		expect(snapshots.map(({ status }) => status)).toEqual(["pending", "queued", "queued"]);
		await waitUntil(() => fixture.coordinator.get("first")?.status === "running");
		fixture.children[0]?.complete("first result");
		await waitUntil(
			() =>
				fixture.coordinator.get("first")?.status === "completed" &&
				fixture.coordinator.get("second")?.status === "running",
		);

		expect(fixture.coordinator.get("first")).toMatchObject({ status: "completed" });
		expect(fixture.coordinator.get("second")).toMatchObject({ status: "running" });
		expect(fixture.coordinator.get("third")).toMatchObject({ status: "queued" });
	});

	it("interrupts and resumes the same transcript through follow-up", async () => {
		const fixture = createFixture();
		await fixture.coordinator.spawn(request("resumable"));

		expect(fixture.coordinator.interrupt("resumable")).toMatchObject({
			status: "interrupted",
			generation: 1,
		});
		const resumed = await fixture.coordinator.followUp("resumable", "continue");

		expect(resumed).toMatchObject({ status: "running", task: "continue" });
		expect(fixture.children).toHaveLength(1);
		expect(fixture.children[0]?.prompts.at(-1)).toBe("continue");
	});

	it("keeps interrupted workflows when a new batch clears completed peers", async () => {
		const fixture = createFixture();
		await fixture.coordinator.spawn(request("completed", "workflow"));
		fixture.children[0]?.complete("done");
		await waitUntil(() => fixture.coordinator.get("completed")?.status === "completed");
		await fixture.coordinator.spawn(request("interrupted", "workflow"));
		fixture.coordinator.interrupt("interrupted");

		fixture.coordinator.spawnMany([request("new_scope", "workflow")]);

		expect(fixture.coordinator.get("completed")).toBeUndefined();
		expect(fixture.coordinator.get("interrupted")).toMatchObject({ status: "interrupted" });
		expect(fixture.coordinator.get("new_scope")).toBeDefined();
	});

	it("reuses a completed workflow name when the next batch replaces completed peers", async () => {
		const fixture = createFixture();
		await fixture.coordinator.spawn(request("same_scope", "workflow"));
		fixture.children[0]?.complete("done");
		await waitUntil(() => fixture.coordinator.get("same_scope")?.status === "completed");

		const [replacement] = fixture.coordinator.spawnMany([request("same_scope", "workflow")]);

		expect(replacement).toMatchObject({ taskName: "same_scope", agentType: "workflow" });
		expect(fixture.coordinator.list()).toHaveLength(1);
	});

	it("checks capacity before reopening a terminal child", async () => {
		const fixture = createFixture({ maxConcurrent: 1, reopen: true });
		fixture.coordinator.restore({
			agents: [snapshot("recovered", "interrupted", { generation: 1, sessionFile: "recovered.jsonl" })],
			delivered: [],
		});
		await fixture.coordinator.spawn(request("active"));

		await expect(fixture.coordinator.followUp("recovered", "continue")).rejects.toThrow("Too many active subagents");
		expect(fixture.children).toHaveLength(1);
		expect(fixture.coordinator.get("recovered")).toMatchObject({ status: "interrupted" });
	});

	it("keeps the slot occupied until an interrupted child is idle", async () => {
		const delayed = new DelayedAbortChild("delayed-child");
		let createCount = 0;
		const fixture = createFixture({
			maxConcurrent: 1,
			factory: {
				async create() {
					createCount += 1;
					return createCount === 1 ? delayed : new TestChild("next-child");
				},
			},
		});
		fixture.coordinator.spawnMany([request("first"), request("second")]);
		await waitUntil(() => fixture.coordinator.get("first")?.status === "running");

		fixture.coordinator.interrupt("first");
		await delay(10);
		expect(fixture.coordinator.get("second")).toMatchObject({ status: "queued" });
		delayed.releaseAbort();
		await waitUntil(() => fixture.coordinator.get("second")?.status === "running");
	});

	it("interrupts a queued workflow without starting it", async () => {
		const fixture = createFixture({ maxConcurrent: 1 });
		fixture.coordinator.spawnMany([request("first", "workflow"), request("second", "workflow")]);
		await waitUntil(() => fixture.coordinator.get("first")?.status === "running");

		expect(fixture.coordinator.interrupt("second")).toMatchObject({ status: "interrupted" });
		fixture.children[0]?.complete("done");
		await delay(10);
		expect(fixture.children).toHaveLength(1);
		expect(fixture.coordinator.get("second")).toMatchObject({ status: "interrupted" });
	});
});
