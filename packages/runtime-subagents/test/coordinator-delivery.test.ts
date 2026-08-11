import { describe, expect, it, vi } from "vitest";
import type { SubagentSnapshot } from "../src/index.js";
import { request } from "./support/builders.js";
import { createFixture } from "./support/fixture.js";
import { delay, waitUntil } from "./support/wait.js";

describe("SubagentCoordinator delivery", () => {
	it("lets wait claim a generation before automatic notification", async () => {
		const onNotify = vi.fn();
		const onDeliveryClaimed = vi.fn();
		const fixture = createFixture({ onNotify, onDeliveryClaimed, notificationDelayMs: 10 });
		await fixture.coordinator.spawn(request("claimed"));
		fixture.children[0]?.complete("done");
		const result = await fixture.coordinator.wait({ targets: ["claimed"], timeoutMs: 1_000 });
		await delay(20);

		expect(result.agents).toEqual([expect.objectContaining({ taskName: "claimed", finalText: "done" })]);
		expect(onNotify).not.toHaveBeenCalled();
		expect(onDeliveryClaimed).toHaveBeenCalledWith({ id: "child-1", generation: 1 });
		expect((await fixture.coordinator.wait({ targets: ["claimed"] })).agents).toEqual([]);
	});

	it("emits terminal snapshots without model-facing tool protocol", async () => {
		const onNotify = vi.fn();
		const fixture = createFixture({ onNotify, notificationDelayMs: 1 });
		await fixture.coordinator.spawn(request("notified"));

		fixture.children[0]?.complete("done");
		await vi.waitFor(() => expect(onNotify).toHaveBeenCalledOnce());

		expect(onNotify).toHaveBeenCalledWith([
			expect.objectContaining({ taskName: "notified", status: "completed", finalText: "done" }),
		]);
		expect(await fixture.coordinator.wait({ targets: ["notified"] })).toEqual({ timedOut: false, agents: [] });
	});

	it("batches terminal notifications in completion order", async () => {
		const onNotify = vi.fn();
		const fixture = createFixture({ onNotify, notificationDelayMs: 5 });
		fixture.coordinator.spawnMany([request("first"), request("second")]);
		await waitUntil(() => fixture.children.length === 2);

		fixture.children[1]?.complete("second result");
		fixture.children[0]?.complete("first result");
		await vi.waitFor(() => expect(onNotify).toHaveBeenCalledOnce());

		expect(onNotify.mock.calls[0]?.[0].map(({ taskName }: SubagentSnapshot) => taskName)).toEqual([
			"second",
			"first",
		]);
	});

	it("wakes active waiters with interrupted snapshots during shutdown", async () => {
		const fixture = createFixture();
		await fixture.coordinator.spawn(request("waiting"));
		const waiting = fixture.coordinator.wait({ targets: ["waiting"], timeoutMs: 5_000 });

		await fixture.coordinator.dispose();

		await expect(waiting).resolves.toEqual({
			timedOut: false,
			agents: [expect.objectContaining({ taskName: "waiting", status: "interrupted", generation: 1 })],
		});
	});
});
