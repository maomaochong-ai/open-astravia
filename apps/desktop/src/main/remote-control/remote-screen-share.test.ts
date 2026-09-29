import type { RemoteScreenStatus } from "@vetta/remote-control";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteScreenShare, type ScreenShareHost } from "./remote-screen-share.js";

function fakeHost(options: { captures?: boolean; input?: boolean } = {}) {
	const calls: boolean[] = [];
	let input = options.input ?? true;
	const host: ScreenShareHost = {
		setScreen: async (active) => {
			calls.push(active);
			return active && (options.captures ?? true);
		},
		refreshInput: () => input,
	};
	return {
		host,
		calls,
		setInput: (value: boolean) => {
			input = value;
		},
	};
}

function share(hosts: Map<string, ScreenShareHost>, permissions = { screen: true, input: true }) {
	const emitted: Array<{ deviceId: string; status: RemoteScreenStatus }> = [];
	const missing: Array<{ deviceId: string; screen: boolean; input: boolean }> = [];
	const screenShare = new RemoteScreenShare({
		permissions: { screenAllowed: () => permissions.screen, inputAllowed: () => permissions.input },
		hostFor: (deviceId) => hosts.get(deviceId),
		emit: (deviceId, status) => emitted.push({ deviceId, status }),
		notifyMissing: (deviceId, what) => missing.push({ deviceId, ...what }),
		pollMs: 10,
	});
	return { screenShare, emitted, missing, permissions };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("RemoteScreenShare", () => {
	it("captures only between a phone's subscribe and unsubscribe", async () => {
		const phone = fakeHost();
		const { screenShare } = share(new Map([["phone", phone.host]]));

		await expect(screenShare.subscribe("phone", true)).resolves.toEqual({ screen: "streaming", input: "ready" });
		await expect(screenShare.subscribe("phone", false)).resolves.toEqual({ screen: "stopped", input: "ready" });
		expect(phone.calls).toEqual([true, false]);
		expect(screenShare.isSubscribed("phone")).toBe(false);
	});

	it("keeps capturing for another phone that still watches the same host", async () => {
		const shared = fakeHost();
		const { screenShare } = share(
			new Map([
				["pixel", shared.host],
				["iphone", shared.host],
			]),
		);
		await screenShare.subscribe("pixel", true);
		await screenShare.subscribe("iphone", true);
		await screenShare.subscribe("pixel", false);
		expect(shared.calls).toEqual([true, true]);
		await screenShare.subscribe("iphone", false);
		expect(shared.calls).toEqual([true, true, false]);
	});

	it("explains a missing Screen Recording permission instead of capturing black, and asks the desktop once", async () => {
		const phone = fakeHost();
		const { screenShare, missing } = share(new Map([["phone", phone.host]]), { screen: false, input: true });

		await expect(screenShare.subscribe("phone", true)).resolves.toEqual({
			screen: "permission_denied",
			input: "ready",
		});
		await screenShare.subscribe("phone", true);
		expect(phone.calls).toEqual([]);
		expect(missing).toEqual([{ deviceId: "phone", screen: true, input: false }]);
		screenShare.stop();
	});

	it("tells the phone as soon as a missing permission is granted", async () => {
		const phone = fakeHost({ input: false });
		const { screenShare, emitted, permissions } = share(new Map([["phone", phone.host]]), {
			screen: true,
			input: false,
		});
		await expect(screenShare.subscribe("phone", true)).resolves.toEqual({
			screen: "streaming",
			input: "permission_denied",
		});

		permissions.input = true;
		phone.setInput(true);
		await vi.waitFor(() =>
			expect(emitted).toEqual([{ deviceId: "phone", status: { screen: "streaming", input: "ready" } }]),
		);
		screenShare.stop();
	});

	it("reports the screen unavailable while the phone has no P2P host, and brings it back when one comes up", async () => {
		const hosts = new Map<string, ScreenShareHost>();
		const { screenShare, emitted } = share(hosts);
		await expect(screenShare.subscribe("phone", true)).resolves.toEqual({
			screen: "unavailable",
			input: "unsupported",
		});

		const phone = fakeHost();
		hosts.set("phone", phone.host);
		await screenShare.hostReady("phone");
		expect(phone.calls).toEqual([true]);
		expect(emitted).toEqual([{ deviceId: "phone", status: { screen: "streaming", input: "ready" } }]);
		screenShare.stop();
	});

	it("stays unsubscribed when the phone leaves while its capture is still starting", async () => {
		let started: (() => void) | undefined;
		const calls: boolean[] = [];
		const slow: ScreenShareHost = {
			setScreen: (active) => {
				calls.push(active);
				if (!active) return Promise.resolve(false);
				return new Promise((resolve) => {
					started = () => resolve(true);
				});
			},
			refreshInput: () => true,
		};
		const { screenShare } = share(new Map([["phone", slow]]));
		const opening = screenShare.subscribe("phone", true);
		await vi.waitFor(() => expect(started).toBeDefined());
		await screenShare.subscribe("phone", false);
		started?.();
		await opening;
		expect(screenShare.isSubscribed("phone")).toBe(false);
		expect(calls).toEqual([true, false]);
	});

	it("keeps capturing for a phone whose subscription is still starting when another leaves", async () => {
		let started: (() => void) | undefined;
		const calls: boolean[] = [];
		const shared: ScreenShareHost = {
			setScreen: (active) => {
				calls.push(active);
				if (!active) return Promise.resolve(false);
				if (calls.length === 1) return Promise.resolve(true);
				return new Promise((resolve) => {
					started = () => resolve(true);
				});
			},
			refreshInput: () => true,
		};
		const { screenShare } = share(
			new Map([
				["pixel", shared],
				["iphone", shared],
			]),
		);
		await screenShare.subscribe("pixel", true);
		const opening = screenShare.subscribe("iphone", true);
		await vi.waitFor(() => expect(started).toBeDefined());
		await screenShare.subscribe("pixel", false);
		started?.();
		await opening;
		expect(calls).toEqual([true, true]);
		screenShare.stop();
	});

	it("does not restart capture for a phone that went away", async () => {
		const phone = fakeHost();
		const { screenShare } = share(new Map([["phone", phone.host]]));
		await screenShare.subscribe("phone", true);
		screenShare.forget("phone");
		await screenShare.hostReady("phone");
		expect(phone.calls).toEqual([true]);
	});

	it("sends the pointer's shape to a phone that draws it, and again only when it changes", async () => {
		const phone = fakeHost();
		const shapes: string[] = [];
		let shown = "arrow";
		const screenShare = new RemoteScreenShare({
			permissions: { screenAllowed: () => true, inputAllowed: () => true },
			hostFor: () => phone.host,
			emit: () => undefined,
			notifyMissing: () => undefined,
			readCursor: () => ({ image: shown, width: 28, height: 40, hotspotX: 5, hotspotY: 5, screenWidth: 1512 }),
			emitCursor: (deviceId, cursor) => shapes.push(`${deviceId}:${cursor.image}`),
			cursorPollMs: 5,
		});
		await screenShare.subscribe("iphone", true, true);
		await screenShare.subscribe("pixel", true);
		expect(shapes).toEqual(["iphone:arrow"]);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(shapes).toEqual(["iphone:arrow"]);
		shown = "ibeam";
		await vi.waitFor(() => expect(shapes).toEqual(["iphone:arrow", "iphone:ibeam"]));
		await screenShare.subscribe("iphone", false);
		shown = "hand";
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(shapes).toHaveLength(2);
		screenShare.stop();
	});

	it("says input is unsupported where the desktop cannot inject it", async () => {
		const phone = fakeHost({ input: false });
		const { screenShare } = share(new Map([["phone", phone.host]]));
		await expect(screenShare.subscribe("phone", true)).resolves.toEqual({
			screen: "streaming",
			input: "unsupported",
		});
		screenShare.stop();
	});

	it("reports a capture that failed to start as unavailable", async () => {
		const phone = fakeHost({ captures: false });
		const { screenShare } = share(new Map([["phone", phone.host]]));
		await expect(screenShare.subscribe("phone", true)).resolves.toEqual({ screen: "unavailable", input: "ready" });
		screenShare.stop();
	});
});
