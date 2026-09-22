import { FakeTransport, generateIdentityKeyPair, RemoteConnection } from "@vetta/remote-control";
import { describe, expect, it } from "vitest";
import { DesktopRemoteDeviceHub } from "./desktop-remote-device-hub.js";

const capabilities = { chat: true, sessionRead: true } as const;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(rounds = 8) {
	for (let index = 0; index < rounds; index += 1) await tick();
}

function link(hub: DesktopRemoteDeviceHub, deviceId: string, channel: "lan" | "relay") {
	const phoneTransport = new FakeTransport();
	const desktopTransport = new FakeTransport();
	phoneTransport.connectPeer(desktopTransport);
	const phoneIdentity = generateIdentityKeyPair();
	const desktopIdentity = generateIdentityKeyPair();
	const phone = new RemoteConnection(phoneTransport, {
		role: "mobile",
		deviceId: "phone",
		deviceName: "Phone",
		capabilities,
		identity: phoneIdentity,
		expectedPeerIdentityKey: desktopIdentity.publicKey,
	});
	const desktop = new RemoteConnection(desktopTransport, {
		role: "desktop",
		handshake: "accept",
		deviceId: "desktop",
		deviceName: "Desktop",
		capabilities,
		identity: desktopIdentity,
		expectedPeerIdentityKey: phoneIdentity.publicKey,
		journal: hub.journalFor(deviceId),
	});
	hub.attach(deviceId, { channel, connection: desktop });
	return { phone, desktop, phoneTransport };
}

describe("DesktopRemoteDeviceHub", () => {
	it("fans one sequenced event out to every link of a device and routes requests back", async () => {
		const online: string[] = [];
		const hub = new DesktopRemoteDeviceHub(
			{
				handleRequest: async (deviceId, request) => ({ deviceId, method: request.method }),
				toRemoteError: () => ({ code: "internal_error", message: "boom", retryable: false }),
				onDeviceOnline: (deviceId) => online.push(deviceId),
			},
			{ offlineGraceMs: 10 },
		);
		const lan = link(hub, "device-1", "lan");
		const relay = link(hub, "device-1", "relay");
		const seen: Array<[string, number]> = [];
		for (const [name, phone] of [
			["lan", lan.phone],
			["relay", relay.phone],
		] as const) {
			phone.onEvent((event) => {
				if (event.type === "remote-event") seen.push([name, event.event.sequence]);
			});
		}
		await lan.desktop.connect();
		await relay.desktop.connect();
		await lan.phone.connect();
		await relay.phone.connect();
		await settle();

		expect(online).toEqual(["device-1"]);
		expect(hub.onlineChannels("device-1").sort()).toEqual(["lan", "relay"]);

		await hub.emit("device-1", "session.state", { status: "running" }, "s1");
		await hub.broadcast("session.list", { sessions: [] });
		await settle();
		expect(seen.sort()).toEqual([
			["lan", 1],
			["lan", 2],
			["relay", 1],
			["relay", 2],
		]);
		await expect(relay.phone.request("session.list")).resolves.toEqual({
			deviceId: "device-1",
			method: "session.list",
		});
	});

	it("keeps a device online across a channel switch and reports offline after the grace period", async () => {
		const events: string[] = [];
		const hub = new DesktopRemoteDeviceHub(
			{
				handleRequest: async () => ({}),
				toRemoteError: () => ({ code: "internal_error", message: "boom", retryable: false }),
				onDeviceOnline: () => events.push("online"),
				onDeviceOffline: () => events.push("offline"),
			},
			{ offlineGraceMs: 20 },
		);
		const lan = link(hub, "device-1", "lan");
		await lan.desktop.connect();
		await lan.phone.connect();
		await settle();
		expect(events).toEqual(["online"]);

		// Phone drops LAN and shows up on relay within the grace window.
		await lan.phone.close();
		await settle();
		const relay = link(hub, "device-1", "relay");
		await relay.desktop.connect();
		await relay.phone.connect();
		await settle();
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(events).toEqual(["online"]);
		expect(hub.isOnline("device-1")).toBe(true);

		// Events emitted meanwhile continue the same sequence for the new link.
		const seen: number[] = [];
		relay.phone.onEvent((event) => {
			if (event.type === "remote-event") seen.push(event.event.sequence);
		});
		await hub.emit("device-1", "session.state", { status: "idle" }, "s1");
		await settle();
		expect(seen).toEqual([1]);

		await relay.desktop.close();
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(events).toEqual(["online", "offline"]);
		expect(hub.isOnline("device-1")).toBe(false);
	});

	it("answers a failing request with the mapped protocol error", async () => {
		const hub = new DesktopRemoteDeviceHub(
			{
				handleRequest: async () => {
					throw new Error("nope");
				},
				toRemoteError: () => ({ code: "not_found", message: "Desktop session was not found", retryable: false }),
			},
			{ offlineGraceMs: 10 },
		);
		const lan = link(hub, "device-1", "lan");
		await lan.desktop.connect();
		await lan.phone.connect();
		await settle();
		await expect(lan.phone.request("session.open", undefined, "missing")).rejects.toThrow(
			"Desktop session was not found",
		);
	});
});
