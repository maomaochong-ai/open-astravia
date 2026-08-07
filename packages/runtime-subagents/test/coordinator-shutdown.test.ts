import { describe, expect, it } from "vitest";
import type { SubagentChildHandle } from "../src/index.js";
import { request, snapshot } from "./support/builders.js";
import { createFixture } from "./support/fixture.js";
import { TestChild } from "./support/test-child.js";
import { waitUntil } from "./support/wait.js";

describe("SubagentCoordinator shutdown", () => {
	it("owns a child factory result that resolves after shutdown starts", async () => {
		let createSignal: AbortSignal | undefined;
		let resolveCreate = (_child: SubagentChildHandle) => {};
		const created = new Promise<SubagentChildHandle>((resolve) => {
			resolveCreate = resolve;
		});
		const activeChild = new TestChild("active-child");
		const lateChild = new TestChild("late-child");
		const fixture = createFixture({
			maxConcurrent: 2,
			factory: {
				async create(spawnRequest, _type, signal) {
					if (spawnRequest.taskName === "active") return activeChild;
					createSignal = signal;
					return created;
				},
			},
		});
		await fixture.coordinator.spawn(request("active"));
		const spawning = fixture.coordinator.spawn(request("creating"));
		const firstDispose = fixture.coordinator.dispose();

		expect(fixture.coordinator.dispose()).toBe(firstDispose);
		expect(createSignal?.aborted).toBe(true);
		await waitUntil(() => activeChild.disposeCalls === 1);
		resolveCreate(lateChild);
		await expect(spawning).rejects.toThrow("Parent session disposed during subagent spawn");
		await firstDispose;
		expect(lateChild.disposeCalls).toBe(1);
	});

	it("owns a reopened child that resolves after shutdown starts", async () => {
		let reopenSignal: AbortSignal | undefined;
		let resolveReopen = (_child: SubagentChildHandle) => {};
		const reopened = new Promise<SubagentChildHandle>((resolve) => {
			resolveReopen = resolve;
		});
		const lateChild = new TestChild("late-reopened-child");
		const fixture = createFixture({
			factory: {
				async create() {
					return new TestChild("unused-child");
				},
				async reopen(_snapshot, _type, signal) {
					reopenSignal = signal;
					return reopened;
				},
			},
		});
		fixture.coordinator.restore({
			agents: [snapshot("recovered", "interrupted", { generation: 1, sessionFile: "recovered.jsonl" })],
			delivered: [],
		});

		const followingUp = fixture.coordinator.followUp("recovered", "continue");
		await waitUntil(() => reopenSignal !== undefined);
		const disposing = fixture.coordinator.dispose();
		expect(reopenSignal?.aborted).toBe(true);
		resolveReopen(lateChild);

		await expect(followingUp).rejects.toThrow("Parent session disposed during subagent reopen");
		await disposing;
		expect(lateChild.disposeCalls).toBe(1);
	});
});
