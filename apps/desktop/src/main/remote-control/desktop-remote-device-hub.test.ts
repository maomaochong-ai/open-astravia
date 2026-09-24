import { FakeTransport, generateIdentityKeyPair, RemoteConnection } from "@vetta/remote-control";
import { describe, expect, it, vi } from "vitest";
import { DesktopRemoteDeviceHub } from "./desktop-remote-device-hub.js";

const capabilities = { chat: true, sessionRead: true } as const;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(rounds = 8) {
	for (let index = 0; index < rounds; index += 1) await tick();
}

function link(hub: DesktopRemoteDeviceHub, deviceId: string, channel: "p2p" | "lan" | "relay") {
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
	it("delivers through the best link without duplicating events and routes requests back", async () => {
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
		const p2p = link(hub, "device-1", "p2p");
		const seen: Array<[string, number]> = [];
		for (const [name, phone] of [
			["lan", lan.phone],
			["relay", relay.phone],
			["p2p", p2p.phone],
		] as const) {
			phone.onEvent((event) => {
				if (event.type === "remote-event") seen.push([name, event.event.sequence]);
			});
		}
		await lan.desktop.connect();
		await relay.desktop.connect();
		await lan.phone.connect();
		await relay.phone.connect();
		await p2p.desktop.connect();
		await p2p.phone.connect();
		await settle();

		expect(online).toEqual(["device-1"]);
		expect(hub.onlineChannels("device-1").sort()).toEqual(["lan", "p2p", "relay"]);

		await hub.emit("device-1", "session.state", { status: "running" }, "s1");
		await hub.broadcast("session.list", { sessions: [] });
		await settle();
		expect(seen).toEqual([
			["p2p", 1],
			["p2p", 2],
		]);
		await expect(relay.phone.request("session.list")).resolves.toEqual({
			deviceId: "device-1",
			method: "session.list",
		});
	});

	it("falls back from P2P to LAN and then relay while keeping the sequence", async () => {
		const hub = new DesktopRemoteDeviceHub(
			{
				handleRequest: async () => ({}),
				toRemoteError: () => ({ code: "internal_error", message: "boom", retryable: false }),
			},
			{ offlineGraceMs: 10 },
		);
		const relay = link(hub, "device-1", "relay");
		const lan = link(hub, "device-1", "lan");
		const p2p = link(hub, "device-1", "p2p");
		const seen: string[] = [];
		for (const [name, phone] of [
			["relay", relay.phone],
			["lan", lan.phone],
			["p2p", p2p.phone],
		] as const) {
			phone.onEvent((event) => {
				if (event.type === "remote-event") seen.push(`${name}:${event.event.sequence}`);
			});
		}
		for (const item of [relay, lan, p2p]) {
			await item.desktop.connect();
			await item.phone.connect();
		}
		await settle();
		await hub.emit("device-1", "session.list", {});
		await p2p.phone.close();
		await settle();
		await hub.emit("device-1", "session.list", {});
		await lan.phone.close();
		await settle();
		await hub.emit("device-1", "session.list", {});
		await settle();
		expect(seen.map((item) => item.split(":")[0])).toEqual(["p2p", "lan", "relay"]);
		expect(seen.map((item) => Number(item.split(":")[1]))).toEqual(
			[...seen.map((item) => Number(item.split(":")[1]))].sort((left, right) => left - right),
		);
	});

	it("uses the next online channel when delivery on P2P fails", async () => {
		const hub = new DesktopRemoteDeviceHub({
			handleRequest: async () => ({}),
			toRemoteError: () => ({ code: "internal_error", message: "boom", retryable: false }),
		});
		const p2pDeliver = vi.fn(async () => {
			throw new Error("ICE failed");
		});
		const relayDeliver = vi.fn(async () => undefined);
		const connection = (deliverEvent: typeof relayDeliver) =>
			({
				onEvent: () => () => undefined,
				getSnapshot: () => ({ state: "online" }),
				deliverEvent,
			}) as unknown as RemoteConnection;
		hub.attach("device-1", { channel: "p2p", connection: connection(p2pDeliver) });
		hub.attach("device-1", { channel: "relay", connection: connection(relayDeliver) });

		await hub.emit("device-1", "session.list", {});
		expect(p2pDeliver).toHaveBeenCalledOnce();
		expect(relayDeliver).toHaveBeenCalledOnce();
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

		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			// Phone drops LAN and shows up on relay before the grace timer expires.
			await lan.phone.close();
			const relay = link(hub, "device-1", "relay");
			await relay.desktop.connect();
			await relay.phone.connect();
			await vi.advanceTimersByTimeAsync(0);
			expect(relay.desktop.getSnapshot().state).toBe("online");
			await vi.advanceTimersByTimeAsync(20);
			expect(events).toEqual(["online"]);
			expect(hub.isOnline("device-1")).toBe(true);

			// Events emitted meanwhile continue the same sequence for the new link.
			const seen: number[] = [];
			relay.phone.onEvent((event) => {
				if (event.type === "remote-event") seen.push(event.event.sequence);
			});
			await hub.emit("device-1", "session.state", { status: "idle" }, "s1");
			await vi.advanceTimersByTimeAsync(0);
			expect(seen).toEqual([1]);

			await relay.desktop.close();
			await vi.advanceTimersByTimeAsync(19);
			expect(events).toEqual(["online"]);
			await vi.advanceTimersByTimeAsync(1);
			expect(events).toEqual(["online", "offline"]);
			expect(hub.isOnline("device-1")).toBe(false);
		} finally {
			vi.useRealTimers();
		}
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
