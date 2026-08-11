import { describe, expect, it, vi } from "vitest";
import type { SubagentLifecycle } from "../src/index.js";
import { request } from "./support/builders.js";
import { createFixture } from "./support/fixture.js";
import { delay, waitUntil } from "./support/wait.js";

describe("SubagentCoordinator lifecycle", () => {
	it("runs start and stop lifecycle policy around a successful child", async () => {
		const calls: string[] = [];
		const lifecycle: SubagentLifecycle = {
			async beforeStart() {
				calls.push("start");
				return { message: "policy: read-only\n\ninspect" };
			},
			async beforeStop() {
				calls.push("stop");
				return {};
			},
		};
		const fixture = createFixture({ lifecycle });

		await fixture.coordinator.spawn(request("lifecycle"));
		expect(fixture.children[0]?.prompts[0]).toContain("policy: read-only");
		fixture.children[0]?.complete("done");
		await waitUntil(() => fixture.coordinator.get("lifecycle")?.status === "completed");

		expect(calls).toEqual(["start", "stop"]);
	});

	it("caps stop lifecycle continuations without stranding the active slot", async () => {
		let stopCalls = 0;
		const fixture = createFixture({
			lifecycle: {
				async beforeStop() {
					stopCalls += 1;
					return { continuation: `continue-${stopCalls}` };
				},
			},
		});
		await fixture.coordinator.spawn(request("continuations"));
		await waitUntil(() => fixture.children[0]?.prompts.length === 1);

		for (let completion = 1; completion <= 9; completion += 1) {
			fixture.children[0]?.complete(`result-${completion}`);
			if (completion <= 8) await waitUntil(() => fixture.children[0]?.prompts.length === completion + 1);
		}
		await waitUntil(() => fixture.coordinator.get("continuations")?.status === "completed");

		expect(stopCalls).toBe(9);
		expect(fixture.children[0]?.prompts).toHaveLength(9);
	});

	it("does not overwrite an interrupt while beforeStop is in flight", async () => {
		let releaseStop = () => {};
		const stopGate = new Promise<void>((resolve) => {
			releaseStop = resolve;
		});
		let stopStarted = false;
		const fixture = createFixture({
			lifecycle: {
				async beforeStop({ interrupted }) {
					if (interrupted) return undefined;
					stopStarted = true;
					await stopGate;
					return { continuation: "must not run" };
				},
			},
		});
		await fixture.coordinator.spawn(request("racing_stop"));
		fixture.children[0]?.complete("done");
		await waitUntil(() => stopStarted);

		fixture.coordinator.interrupt("racing_stop");
		releaseStop();
		await delay(10);

		expect(fixture.coordinator.get("racing_stop")).toMatchObject({ status: "interrupted", generation: 1 });
		expect(fixture.children[0]?.prompts).toHaveLength(1);
	});

	it("completes and refills capacity when beforeStop throws", async () => {
		const onError = vi.fn();
		const fixture = createFixture({
			maxConcurrent: 1,
			onError,
			lifecycle: {
				async beforeStop() {
					throw new Error("hook unavailable");
				},
			},
		});
		fixture.coordinator.spawnMany([request("first"), request("second")]);
		await waitUntil(() => fixture.coordinator.get("first")?.status === "running");
		fixture.children[0]?.complete("done");
		await waitUntil(() => fixture.coordinator.get("second")?.status === "running");

		expect(fixture.coordinator.get("first")).toMatchObject({ status: "completed" });
		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ message: "hook unavailable" }),
			"subagent beforeStop lifecycle",
		);
	});

	it("fails and disposes the child when start lifecycle blocks", async () => {
		const fixture = createFixture({
			lifecycle: {
				async beforeStart() {
					return { blockedReason: "subagents disabled by policy" };
				},
			},
		});

		await expect(fixture.coordinator.spawn(request("blocked"))).rejects.toThrow("subagents disabled by policy");
		expect(fixture.coordinator.get("blocked")).toMatchObject({
			status: "failed",
			errorMessage: "subagents disabled by policy",
		});
		expect(fixture.children[0]?.disposeCalls).toBe(1);
	});
});
