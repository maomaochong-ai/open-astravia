import type { IpcRenderer, IpcRendererEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createPluginsApi } from "./plugins";

const SETTINGS_CHANGED_CHANNEL = "vetta:plugins:settings-changed";
type IpcListener = Parameters<IpcRenderer["on"]>[1];

describe("createPluginsApi settings events", () => {
	it("multiplexes more than ten subscribers through one IPC listener", () => {
		const harness = createIpcHarness();
		const plugins = createPluginsApi(harness.ipc).plugins;
		const listeners = Array.from({ length: 12 }, () => vi.fn());
		const unsubscribers = listeners.map((listener) => plugins.onSettingsChanged(listener));
		const payload = { pluginId: "plugin", values: { enabled: true } };

		expect(harness.listenerCount(SETTINGS_CHANGED_CHANNEL)).toBe(1);
		expect(harness.on).toHaveBeenCalledTimes(1);

		harness.emit(SETTINGS_CHANGED_CHANNEL, payload);
		for (const listener of listeners) expect(listener).toHaveBeenCalledOnce();

		for (const unsubscribe of unsubscribers) unsubscribe();
	});

	it("detaches the shared IPC listener after the final subscriber leaves", () => {
		const harness = createIpcHarness();
		const plugins = createPluginsApi(harness.ipc).plugins;
		const first = vi.fn();
		const second = vi.fn();
		const unsubscribeFirst = plugins.onSettingsChanged(first);
		const unsubscribeSecond = plugins.onSettingsChanged(second);

		unsubscribeFirst();
		harness.emit(SETTINGS_CHANGED_CHANNEL, { pluginId: "plugin", values: {} });
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledOnce();
		expect(harness.listenerCount(SETTINGS_CHANGED_CHANNEL)).toBe(1);

		unsubscribeSecond();
		expect(harness.listenerCount(SETTINGS_CHANGED_CHANNEL)).toBe(0);
		expect(harness.removeListener).toHaveBeenCalledTimes(1);
	});
});

function createIpcHarness(): {
	readonly emit: (channel: string, payload: unknown) => void;
	readonly ipc: IpcRenderer;
	readonly listenerCount: (channel: string) => number;
	readonly on: ReturnType<typeof vi.fn>;
	readonly removeListener: ReturnType<typeof vi.fn>;
} {
	const listeners = new Map<string, Set<IpcListener>>();
	const on = vi.fn((channel: string, listener: IpcListener) => {
		const channelListeners = listeners.get(channel) ?? new Set<IpcListener>();
		channelListeners.add(listener);
		listeners.set(channel, channelListeners);
		return ipc;
	});
	const removeListener = vi.fn((channel: string, listener: IpcListener) => {
		listeners.get(channel)?.delete(listener);
		return ipc;
	});
	const ipc = {
		invoke: vi.fn(async () => undefined),
		on,
		removeListener,
	} as unknown as IpcRenderer;

	return {
		ipc,
		on,
		removeListener,
		emit: (channel, payload) => {
			for (const listener of listeners.get(channel) ?? []) {
				listener({} as IpcRendererEvent, payload);
			}
		},
		listenerCount: (channel) => listeners.get(channel)?.size ?? 0,
	};
}
