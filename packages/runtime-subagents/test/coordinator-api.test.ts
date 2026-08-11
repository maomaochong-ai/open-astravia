import { describe, expect, it, vi } from "vitest";
import { request } from "./support/builders.js";
import { createFixture } from "./support/fixture.js";
import { TestChild } from "./support/test-child.js";
import { waitUntil } from "./support/wait.js";

describe("SubagentCoordinator public API", () => {
	it("validates a batch before reserving any child", () => {
		const fixture = createFixture();

		expect(() => fixture.coordinator.spawnMany([request("valid_task"), request("Invalid")])).toThrow(
			"Invalid task_name",
		);
		expect(fixture.coordinator.list()).toEqual([]);
	});

	it("resolves id, task name and path to the same child", async () => {
		const fixture = createFixture();
		const snapshot = await fixture.coordinator.spawn(request("lookup"));

		expect(fixture.coordinator.get(snapshot.id)).toEqual(fixture.coordinator.get("lookup"));
		expect(fixture.coordinator.get("/root/lookup")).toEqual(fixture.coordinator.get("lookup"));
	});

	it("isolates observer failures from scheduler transitions", async () => {
		const onError = vi.fn();
		const fixture = createFixture({
			onError,
			onUpdate() {
				throw new Error("observer failed");
			},
		});

		await expect(fixture.coordinator.spawn(request("observable"))).resolves.toMatchObject({ status: "running" });
		fixture.children[0]?.complete("done");
		await waitUntil(() => fixture.coordinator.get("observable")?.status === "completed");
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "observer failed" }),
			"publish subagent update",
		);
	});

	it("rejects duplicate child session ids without replacing the first run", async () => {
		const fixture = createFixture({
			maxConcurrent: 2,
			factory: {
				async create() {
					return new TestChild("shared-child-id");
				},
			},
		});
		await fixture.coordinator.spawn(request("first"));

		await expect(fixture.coordinator.spawn(request("second"))).rejects.toThrow(
			'Subagent id "shared-child-id" is already registered',
		);
		expect(fixture.coordinator.get("first")).toMatchObject({ id: "shared-child-id", status: "running" });
		expect(fixture.coordinator.get("second")).toMatchObject({ status: "failed" });
	});

	it("mirrors todo progress and title into workflow snapshots", async () => {
		const fixture = createFixture();
		const [reserved] = fixture.coordinator.spawnMany([
			{ ...request("planned", "workflow"), title: "Refactor API", todos: ["inspect", "change"] },
		]);

		expect(reserved).toMatchObject({ title: "Refactor API", todoProgress: { done: 0, total: 2 } });
		await waitUntil(() => fixture.children.length === 1);
		fixture.children[0]?.updateTodoProgress({ done: 1, total: 2 });
		expect(fixture.coordinator.get("planned")).toMatchObject({
			title: "Refactor API",
			todoProgress: { done: 1, total: 2 },
		});
	});

	it("clears only terminal children and frees their task names", async () => {
		const fixture = createFixture();
		await fixture.coordinator.spawn(request("clearable"));
		fixture.children[0]?.complete("done");
		await waitUntil(() => fixture.coordinator.get("clearable")?.status === "completed");

		expect(fixture.coordinator.clearFinished()).toBe(1);
		expect(fixture.coordinator.list()).toEqual([]);
		await expect(fixture.coordinator.spawn(request("clearable"))).resolves.toMatchObject({ taskName: "clearable" });
	});
});
