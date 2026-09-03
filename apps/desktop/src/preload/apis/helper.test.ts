import type { IpcRenderer, IpcRendererEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { subscribeById } from "./helper";

type IpcListener = Parameters<IpcRenderer["on"]>[1];

describe("subscribeById", () => {
	it("delivers the subscription snapshot after the listener is installed", async () => {
		const harness = createIpcHarness(
			["subscription"],
			[{ type: "session-snapshot" }],
			[{ type: "conversation.agent-message-event", delta: "buffered" }],
		);
		const handler = vi.fn();
		await subscribeById(harness.ipc, "subscribe", "event", "unsubscribe", handler, ["session"]);
		expect(handler.mock.calls).toEqual([
			[{ type: "session-snapshot" }],
			[{ type: "conversation.agent-message-event", delta: "buffered" }],
		]);
		expect(harness.listenerCount("event")).toBe(1);
	});

	it("isolates concurrent subscriptions and unsubscribes only the selected id", async () => {
		const harness = createIpcHarness(["subscription-a", "subscription-b"]);
		const first = vi.fn();
		const second = vi.fn();
		const unsubscribeFirst = await subscribeById(harness.ipc, "subscribe", "event", "unsubscribe", first, [
			"session-a",
		]);
		const unsubscribeSecond = await subscribeById(harness.ipc, "subscribe", "event", "unsubscribe", second, [
			"session-b",
		]);

		harness.emit("event", "subscription-a", { type: "message.delta", delta: "first" });
		expect(first).toHaveBeenCalledWith({ type: "message.delta", delta: "first" });
		expect(second).not.toHaveBeenCalled();

		unsubscribeFirst();
		harness.emit("event", "subscription-b", { type: "message.delta", delta: "second" });
		expect(second).toHaveBeenCalledWith({ type: "message.delta", delta: "second" });
		expect(harness.invoke).toHaveBeenCalledWith("unsubscribe", "subscription-a");
		expect(harness.listenerCount("event")).toBe(1);

		unsubscribeSecond();
		expect(harness.invoke).toHaveBeenCalledWith("unsubscribe", "subscription-b");
		expect(harness.listenerCount("event")).toBe(0);
	});
});

function createIpcHarness(
	subscriptionIds: string[],
	initial: unknown[] = [],
	duringSubscribe: unknown[] = [],
): {
	readonly emit: (channel: string, subscriptionId: string, payload: unknown) => void;
	readonly ipc: IpcRenderer;
	readonly invoke: ReturnType<typeof vi.fn>;
	readonly listenerCount: (channel: string) => number;
} {
	const listeners = new Map<string, Set<IpcListener>>();
	let nextSubscription = 0;
	const emit = (channel: string, subscriptionId: string, payload: unknown): void => {
		for (const listener of listeners.get(channel) ?? []) {
			listener({} as IpcRendererEvent, subscriptionId, payload);
		}
	};
	const invoke = vi.fn(async (channel: string) => {
		if (channel !== "subscribe") return undefined;
		const index = nextSubscription++;
		if (duringSubscribe[index] !== undefined) {
			emit("event", subscriptionIds[index], duringSubscribe[index]);
		}
		return {
			subscriptionId: subscriptionIds[index],
			...(initial[index] === undefined ? {} : { initial: initial[index] }),
		};
	});
	const ipc = {
		invoke,
		on: vi.fn((channel: string, listener: IpcListener) => {
			const current = listeners.get(channel) ?? new Set<IpcListener>();
			current.add(listener);
			listeners.set(channel, current);
			return ipc;
		}),
		removeListener: vi.fn((channel: string, listener: IpcListener) => {
			listeners.get(channel)?.delete(listener);
			return ipc;
		}),
	} as unknown as IpcRenderer;
	return {
		ipc,
		invoke,
		emit,
		listenerCount: (channel) => listeners.get(channel)?.size ?? 0,
	};
}
