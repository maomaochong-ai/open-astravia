import { FakeRelay, FakeTransport, generateIdentityKeyPair, RemoteConnection } from "@vetta/remote-control";
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
	const attached = { channel, connection: desktop };
	hub.attach(deviceId, attached);
	return { phone, desktop, phoneTransport, attached };
}

describe("DesktopRemoteDeviceHub", () => {
	it("only initializes a link attached to that device and preserves the shared journal", async () => {
		const hub = new DesktopRemoteDeviceHub({
			handleRequest: async () => ({}),
			toRemoteError: () => ({ code: "internal_error", message: "boom", retryable: false }),
		});
		const lan = link(hub, "device-1", "lan");
		const seen: number[] = [];
		lan.phone.onEvent((event) => {
			if (event.type === "remote-event") seen.push(event.event.sequence);
		});
		try {
			await lan.desktop.connect();
			await lan.phone.connect();
			await vi.waitFor(() => expect(lan.desktop.getSnapshot().state).toBe("online"));
			const event = await hub.emitToLink("device-1", lan.attached, "device.status", { screen: true });
			await vi.waitFor(() => expect(seen).toEqual([event.sequence]));
			expect(hub.journalFor("device-1").lastSequence).toBe(event.sequence);
			await expect(hub.emitToLink("device-2", lan.attached, "device.status")).rejects.toThrow("no longer attached");
			hub.detach("device-1", lan.attached);
			await expect(hub.emitToLink("device-1", lan.attached, "device.status")).rejects.toThrow("no longer attached");
			expect(hub.journalFor("device-1").lastSequence).toBe(event.sequence);
		} finally {
			await hub.dropAll();
			await lan.phone.close();
			await lan.desktop.close();
		}
	});

	it.each([undefined, "lan", "p2p"] as const)(
		"updates relay presence while the desktop stays in the room (other channel: %s)",
		async (otherChannel) => {
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
			const presence: boolean[] = [];
			const channels: string[][] = [];
			const hub: DesktopRemoteDeviceHub = new DesktopRemoteDeviceHub({
				handleRequest: async (_deviceId, request) => ({ method: request.method }),
				toRemoteError: () => ({ code: "internal_error", message: "boom", retryable: false }),
				onDeviceOnline: () => presence.push(true),
				onDeviceOffline: () => presence.push(false),
				onLinksChanged: (deviceId) => channels.push(hub.onlineChannels(deviceId)),
			});
			const relay = new FakeRelay();
			const phone = new RemoteConnection(relay.createTransport("device-1", "mobile"), {
				role: "mobile",
				deviceId: "phone",
				deviceName: "Phone",
				capabilities,
				identity: generateIdentityKeyPair(),
			});
			const desktop = new RemoteConnection(relay.createTransport("device-1", "desktop"), {
				role: "desktop",
				deviceId: "desktop",
				deviceName: "Desktop",
				capabilities,
				identity: generateIdentityKeyPair(),
				journal: hub.journalFor("device-1"),
			});
			hub.attach("device-1", { channel: "relay", connection: desktop });
			const other = otherChannel ? link(hub, "device-1", otherChannel) : undefined;
			try {
				await desktop.connect();
				await phone.connect();
				await vi.advanceTimersByTimeAsync(0);
				expect(channels.at(-1)).toEqual(["relay"]);
				await expect(phone.request("session.list")).resolves.toEqual({ method: "session.list" });
				if (other) {
					await other.desktop.connect();
					await other.phone.connect();
					await vi.advanceTimersByTimeAsync(0);
				}

				// A brief relay interruption must not report the device offline.
				await phone.close();
				await vi.advanceTimersByTimeAsync(4_999);
				await phone.connect();
				await vi.advanceTimersByTimeAsync(1);
				expect(presence).toEqual([true]);

				await phone.close();
				await vi.advanceTimersByTimeAsync(4_999);
				expect(hub.isOnline("device-1")).toBe(true);
				await vi.advanceTimersByTimeAsync(1);
				if (other) {
					expect(hub.isOnline("device-1")).toBe(true);
					expect(channels.at(-1)).toEqual([otherChannel]);
					expect(presence).toEqual([true]);
					await other.phone.close();
					await vi.advanceTimersByTimeAsync(5_000);
				}
				expect(hub.isOnline("device-1")).toBe(false);
				expect(channels.at(-1)).toEqual([]);
				expect(presence).toEqual([true, false]);

				await phone.connect();
				await vi.advanceTimersByTimeAsync(0);
				expect(hub.isOnline("device-1")).toBe(true);
				expect(channels.at(-1)).toEqual(["relay"]);
				expect(presence).toEqual([true, false, true]);
				await expect(phone.request("session.list")).resolves.toEqual({ method: "session.list" });
			} finally {
				await hub.dropAll();
				await phone.close();
				await other?.phone.close();
				vi.useRealTimers();
			}
		},
	);

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

	it("reports every change of a device's channels, not only coming online and going offline", async () => {
		const seen: string[] = [];
		const hub: DesktopRemoteDeviceHub = new DesktopRemoteDeviceHub(
			{
				handleRequest: async () => ({}),
				toRemoteError: () => ({ code: "internal_error", message: "boom", retryable: false }),
				onLinksChanged: (deviceId) => seen.push(hub.onlineChannels(deviceId).sort().join("+") || "none"),
			},
			{ offlineGraceMs: 5 },
		);
		const lan = link(hub, "device-1", "lan");
		await lan.desktop.connect();
		await lan.phone.connect();
		const p2p = link(hub, "device-1", "p2p");
		await p2p.desktop.connect();
		await p2p.phone.connect();
		await settle();
		expect(seen.at(-1)).toBe("lan+p2p");

		await p2p.desktop.close();
		await settle();
		expect(seen.at(-1)).toBe("lan");

		await hub.drop("device-1");
		expect(seen.at(-1)).toBe("none");
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
