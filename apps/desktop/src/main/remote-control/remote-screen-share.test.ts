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

	it("does not restart capture for a phone that went away", async () => {
		const phone = fakeHost();
		const { screenShare } = share(new Map([["phone", phone.host]]));
		await screenShare.subscribe("phone", true);
		screenShare.forget("phone");
		await screenShare.hostReady("phone");
		expect(phone.calls).toEqual([true]);
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
