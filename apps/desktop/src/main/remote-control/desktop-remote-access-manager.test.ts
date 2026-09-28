import type { RemoteConnection, RemoteTransportHandlers } from "@vetta/remote-control";
import { generateIdentityKeyPair, parsePairingUri, type RemoteHello, toBase64Url } from "@vetta/remote-control";
import { describe, expect, it, vi } from "vitest";
import type { DesktopConfig } from "../config/desktop-config-store.js";
import type { CredentialRef } from "../credentials/credential-vault.js";
import { DesktopRemoteAccessManager, type RemoteAccessState } from "./desktop-remote-access-manager.js";
import type { DesktopRemoteLanServerOptions } from "./desktop-remote-lan-server.js";
import type { DesktopRemoteMirror } from "./desktop-remote-mirror.js";
import type { DesktopRemoteRelayLinkOptions } from "./desktop-remote-relay-link.js";
import { RemoteDeviceStore } from "./remote-device-store.js";

function key(ref: CredentialRef): string {
	return `${ref.namespace}/${ref.ownerId}/${ref.name}`;
}

function harness(initial?: DesktopConfig["remoteControl"], options: { hubGraceMs?: number } = {}) {
	let config: DesktopConfig = {
		projects: [],
		archivedProjects: [],
		remoteControl: initial,
	} as unknown as DesktopConfig;
	const vault = new Map<string, string>();
	let writesFail = false;
	const store = new RemoteDeviceStore({
		readConfig: async () => structuredClone(config),
		writeConfig: async (next) => {
			if (writesFail) throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
			config = structuredClone(next);
		},
		vault: {
			isAvailable: () => true,
			get: (ref) => vault.get(key(ref)),
			put: (ref, value) => void vault.set(key(ref), value),
			remove: (ref) => void vault.delete(key(ref)),
		},
		defaultRelayBaseUrl: "wss://relay.example",
	});
	const lanServers: Array<{ options: DesktopRemoteLanServerOptions; started: boolean; stopped: boolean }> = [];
	const relayLinks: Array<{ options: DesktopRemoteRelayLinkOptions; started: boolean; stopped: boolean }> = [];
	const notifications: string[] = [];
	const mirrors: Array<{ started: boolean; stopped: boolean }> = [];
	const desktopHosts: Array<{
		options: { relayBaseUrl: string; pairingId: string; desktopSecret: string };
		stopped: boolean;
		controlHandlers?: RemoteTransportHandlers;
	}> = [];
	const manager = new DesktopRemoteAccessManager({
		store,
		deviceId: "desktop-1",
		deviceName: "MacBook",
		runningSessionCount: () => 0,
		listLanEndpoints: (port) => [`192.168.1.20:${port}`],
		notifications: {
			deviceConnected: (device) => notifications.push(`connected:${device.name}`),
			pairingRequested: (request) => notifications.push(`pairing:${request.deviceName}:${request.code}`),
		},
		createMirror: () => {
			const entry = { started: false, stopped: false };
			mirrors.push(entry);
			return {
				start: async () => {
					entry.started = true;
				},
				stop: () => {
					entry.stopped = true;
				},
				handleRequest: async () => ({}),
			} as unknown as DesktopRemoteMirror;
		},
		remoteDesktop: {
			start: async (options) => {
				const entry: (typeof desktopHosts)[number] = { options, stopped: false };
				desktopHosts.push(entry);
				let handlers: RemoteTransportHandlers | undefined;
				return {
					sessionId: options.pairingId,
					inputSupported: true,
					controlTransport: {
						connect: async (next: RemoteTransportHandlers) => {
							handlers = next;
							entry.controlHandlers = next;
						},
						send: async () => undefined,
						close: async () => handlers?.onClose("test stopped"),
					},
					revokeInput: () => undefined,
					grantInput: () => undefined,
					stop: async () => {
						entry.stopped = true;
					},
				};
			},
		},
		createLanServer: (options) => {
			const entry = { options, started: false, stopped: false, port: undefined as number | undefined };
			lanServers.push(entry);
			return {
				start: async (preferred = 43117) => {
					entry.started = true;
					entry.port = preferred;
					return preferred;
				},
				stop: async () => {
					entry.stopped = true;
					entry.port = undefined;
				},
				get listeningPort() {
					return entry.port;
				},
			};
		},
		createRelayLink: (options) => {
			const entry = { options, started: false, stopped: false };
			relayLinks.push(entry);
			return {
				start: () => {
					entry.started = true;
				},
				stop: async () => {
					entry.stopped = true;
				},
			};
		},
		inviteTtlMs: 60_000,
		hubGraceMs: options.hubGraceMs ?? 5,
	});
	return {
		manager,
		store,
		vault,
		lanServers,
		relayLinks,
		notifications,
		mirrors,
		desktopHosts,
		readConfig: () => config,
		/** Makes saving the desktop config fail, as a locked file on Windows does. */
		failWrites: (fail: boolean) => {
			writesFail = fail;
		},
	};
}

function hello(identityKey: string, deviceName = "iPhone"): RemoteHello {
	return {
		type: "hello",
		protocolVersion: 2,
		role: "mobile",
		deviceId: "phone-1",
		deviceName,
		capabilities: { chat: true, sessionRead: true },
		connectionId: "c1",
		identityKey,
		ephemeralKey: toBase64Url(generateIdentityKeyPair().publicKey),
	};
}

describe("DesktopRemoteAccessManager", () => {
	it("starts nothing when no phone is paired", async () => {
		const { manager, lanServers, relayLinks, vault } = harness();
		await manager.restore();
		expect(lanServers).toEqual([]);
		expect(relayLinks).toEqual([]);
		expect(vault.size).toBe(0);
		expect(manager.getState()).toMatchObject({ devices: [], approvals: [], lanEndpoints: [], cloudEnabled: true });
	});

	it("creates an invite that opens the LAN server and parks a relay link, then claims the first phone", async () => {
		const { manager, lanServers, relayLinks, readConfig, store } = harness();
		const state = await manager.createInvite();
		expect(state.invite).toBeDefined();
		const invite = parsePairingUri(state.invite?.inviteUri ?? "");
		expect(invite.lanEndpoints).toEqual(["192.168.1.20:43117"]);
		expect(invite.relayBaseUrl).toBe("wss://relay.example");
		expect(invite.desktopName).toBe("MacBook");
		expect(lanServers).toHaveLength(1);
		expect(relayLinks).toHaveLength(1);
		expect(relayLinks[0]?.options.pairingId).toBe(invite.pairingId);
		expect(relayLinks[0]?.options.mobileSecretHash).toBe(readConfig().remoteControl?.devices[0]?.mobileSecretHash);
		expect(store.mobileSecret(invite.pairingId)).toBe(invite.mobileSecret);
		expect(state.devices[0]).toMatchObject({ claimed: false });

		const phoneKey = toBase64Url(generateIdentityKeyPair().publicKey);
		const decision = lanServers[0]?.options.onDeviceHello(
			{ id: invite.pairingId, mobileSecretHash: readConfig().remoteControl?.devices[0]?.mobileSecretHash ?? "" },
			hello(phoneKey),
		);
		expect(decision).toEqual({ kind: "approve" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		const device = readConfig().remoteControl?.devices[0];
		expect(device).toMatchObject({ mobileIdentityKey: phoneKey, name: "iPhone" });
		expect(store.mobileSecret(invite.pairingId)).toBeUndefined();
		expect(manager.getState().invite).toBeUndefined();
		// The relay link restarts with the pinned key so nobody else can take the room.
		expect(relayLinks[0]?.stopped).toBe(true);
		expect(relayLinks[1]?.options.mobileIdentityKey).toBe(phoneKey);
	});

	it("a phone that scans again replaces its earlier pairing instead of adding another", async () => {
		const phoneKey = toBase64Url(generateIdentityKeyPair().publicKey);
		const oldId = "o".repeat(24);
		const { manager, lanServers, readConfig, store, vault } = harness({
			cloudEnabled: true,
			devices: [{ id: oldId, name: "Pixel", mobileSecretHash: "h", mobileIdentityKey: phoneKey, createdAt: 1 }],
		});
		store.putRelaySecret(oldId, "old-relay-secret");
		await manager.restore();
		const state = await manager.createInvite();
		const invite = parsePairingUri(state.invite?.inviteUri ?? "");
		const fresh = readConfig().remoteControl?.devices.find((device) => device.id === invite.pairingId);
		lanServers[0]?.options.onDeviceHello(
			{ id: invite.pairingId, mobileSecretHash: fresh?.mobileSecretHash ?? "" },
			hello(phoneKey, "Pixel"),
		);
		await vi.waitFor(() =>
			expect(readConfig().remoteControl?.devices.map((device) => device.id)).toEqual([invite.pairingId]),
		);
		expect([...vault.keys()].filter((name) => name.includes(oldId))).toEqual([]);

		// Another phone keeps its own pairing.
		const other = await manager.createInvite();
		const otherInvite = parsePairingUri(other.invite?.inviteUri ?? "");
		const otherRecord = readConfig().remoteControl?.devices.find((device) => device.id === otherInvite.pairingId);
		lanServers[0]?.options.onDeviceHello(
			{ id: otherInvite.pairingId, mobileSecretHash: otherRecord?.mobileSecretHash ?? "" },
			hello(toBase64Url(generateIdentityKeyPair().publicKey), "iPhone"),
		);
		await vi.waitFor(() => expect(readConfig().remoteControl?.devices).toHaveLength(2));
	});

	it("tells the settings page what changed instead of being asked", async () => {
		const { manager } = harness();
		const states: RemoteAccessState[] = [];
		const stop = manager.onStateChanged((state) => states.push(state));
		const created = await manager.createInvite();
		await vi.waitFor(() => expect(states.at(-1)?.invite?.pairingId).toBe(created.invite?.pairingId));
		const count = states.length;

		// Nothing new: nothing is sent.
		await manager.renameDevice(created.devices[0]?.id ?? "", "");
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(states).toHaveLength(count);

		await manager.cancelInvite();
		await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ invite: undefined, devices: [] }));
		stop();
	});

	it("revoking the last phone tears every transport down again", async () => {
		const { manager, lanServers, relayLinks, vault, readConfig } = harness();
		const state = await manager.createInvite();
		const id = state.devices[0]?.id ?? "";
		await manager.revokeDevice(id);
		expect(readConfig().remoteControl?.devices).toEqual([]);
		expect(lanServers[0]?.stopped).toBe(true);
		expect(relayLinks.every((link) => link.stopped)).toBe(true);
		expect([...vault.keys()].filter((name) => name.includes(id))).toEqual([]);
		expect(manager.getState().lanPort).toBeUndefined();
	});

	it("turning cloud access off stops relay links and drops the relay from new invites", async () => {
		const { manager, relayLinks } = harness();
		await manager.createInvite();
		expect(relayLinks).toHaveLength(1);
		const state = await manager.setCloudEnabled(false);
		expect(relayLinks[0]?.stopped).toBe(true);
		expect(state.cloudEnabled).toBe(false);
		expect(parsePairingUri(state.invite?.inviteUri ?? "").relayBaseUrl).toBeUndefined();
		await manager.setCloudEnabled(true);
		expect(relayLinks).toHaveLength(2);
	});

	it("surfaces manual pairing requests with their code and resolves them from the settings page", async () => {
		const { manager, lanServers, notifications } = harness({ cloudEnabled: true, devices: [] });
		await manager.createInvite();
		const approval = lanServers[0]?.options.onManualHello(hello("k".repeat(43), "Pixel"), "123456", "conn-9");
		expect(manager.getState().approvals).toEqual([
			{ id: "conn-9", deviceName: "Pixel", code: "123456", requestedAt: expect.any(Number) },
		]);
		expect(notifications).toContain("pairing:Pixel:123456");
		await manager.approvePairing("conn-9", true);
		await expect(approval).resolves.toBe(true);
		expect(manager.getState().approvals).toEqual([]);
	});

	it("restores paired devices on launch and serves their transports", async () => {
		const { manager, lanServers, relayLinks, store } = harness({
			cloudEnabled: true,
			lanPort: 43120,
			devices: [
				{
					id: "a".repeat(24),
					name: "iPhone",
					mobileSecretHash: "h",
					mobileIdentityKey: "k".repeat(43),
					createdAt: 1,
				},
			],
		});
		store.putRelaySecret("a".repeat(24), "relay-secret");
		await manager.restore();
		expect(lanServers[0]?.started).toBe(true);
		expect(manager.getState().lanPort).toBe(43120);
		expect(relayLinks[0]?.options).toMatchObject({
			pairingId: "a".repeat(24),
			desktopSecret: "relay-secret",
			mobileIdentityKey: "k".repeat(43),
		});
		await manager.shutdown();
		expect(lanServers[0]?.stopped).toBe(true);
		expect(relayLinks[0]?.stopped).toBe(true);
	});

	it("tells a connected phone it was unpaired before closing its link", async () => {
		const pairingId = "a".repeat(24);
		const phoneKey = "k".repeat(43);
		const { manager, relayLinks, store } = harness({
			cloudEnabled: true,
			devices: [{ id: pairingId, name: "Pixel", mobileSecretHash: "h", mobileIdentityKey: phoneKey, createdAt: 1 }],
		});
		store.putRelaySecret(pairingId, "relay-secret");
		await manager.restore();
		const wire: string[] = [];
		const connection = {
			onEvent: () => () => undefined,
			getSnapshot: () => ({ state: "online", peerIdentityKey: phoneKey }),
			deliverEvent: async (event: { name: string }) => {
				wire.push(event.name);
			},
			close: async () => {
				wire.push("closed");
			},
		} as unknown as RemoteConnection;
		relayLinks[0]?.options.onConnection(connection);
		await new Promise((resolve) => setTimeout(resolve, 0));

		await manager.revokeDevice(pairingId);
		expect(wire.slice(wire.indexOf("device.revoked"))).toEqual(["device.revoked", "closed"]);
		await manager.shutdown();
	});

	it("brings the screen back when the phone reconnects after it went while the phone was briefly away", async () => {
		const pairingId = "a".repeat(24);
		const phoneKey = "k".repeat(43);
		// The real grace period: a brief absence never counts as the phone going offline.
		const { manager, relayLinks, store, desktopHosts } = harness(
			{
				cloudEnabled: true,
				relayBaseUrl: "wss://relay.example",
				devices: [
					{
						id: pairingId,
						name: "Pixel",
						mobileSecretHash: "h",
						mobileIdentityKey: phoneKey,
						createdAt: 1,
						desktopControl: true,
					},
				],
			},
			{ hubGraceMs: 5_000 },
		);
		store.putRelaySecret(pairingId, "relay-secret");
		await manager.restore();
		const link = (initial: string) => {
			let state = initial;
			const connection = {
				onEvent: () => () => undefined,
				getSnapshot: () => ({ state, peerIdentityKey: phoneKey }),
				deliverEvent: async () => undefined,
				close: async () => undefined,
			} as unknown as RemoteConnection;
			return {
				connection,
				setState: (next: string) => {
					state = next;
				},
			};
		};
		const settle = async () => {
			for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
		};
		const first = link("online");
		relayLinks[0]?.options.onConnection(first.connection);
		await settle();
		expect(desktopHosts).toHaveLength(1);

		// The screen's channel drops just as the phone's other link is reconnecting: nothing to
		// restart it on, and the phone never counted as offline (the grace period covers it).
		first.setState("reconnecting");
		desktopHosts[0]?.controlHandlers?.onClose("ICE failed");
		await settle();
		expect(desktopHosts[0]?.stopped).toBe(true);
		expect(desktopHosts).toHaveLength(1);

		// The phone's link is back: so is the screen.
		relayLinks[0]?.options.onConnection(link("online").connection);
		await settle();
		expect(desktopHosts).toHaveLength(2);
		expect(desktopHosts[1]?.stopped).toBe(false);
		await manager.shutdown();
	});

	it("still serves a phone whose arrival cannot be saved", async () => {
		const pairingId = "a".repeat(24);
		const phoneKey = "k".repeat(43);
		const { manager, relayLinks, store, failWrites } = harness({
			cloudEnabled: true,
			devices: [{ id: pairingId, name: "Pixel", mobileSecretHash: "h", mobileIdentityKey: phoneKey, createdAt: 1 }],
		});
		store.putRelaySecret(pairingId, "relay-secret");
		await manager.restore();
		failWrites(true);
		const delivered: string[] = [];
		const connection = {
			onEvent: () => () => undefined,
			getSnapshot: () => ({ state: "online", peerIdentityKey: phoneKey }),
			deliverEvent: async (event: { name: string }) => {
				delivered.push(event.name);
			},
			close: async () => undefined,
		} as unknown as RemoteConnection;
		relayLinks[0]?.options.onConnection(connection);
		await vi.waitFor(() => expect(delivered).toContain("device.status"));
		await manager.shutdown();
	});

	it("shows the name a phone gives when it connects, replacing an older one", async () => {
		const pairingId = "a".repeat(24);
		const phoneKey = "k".repeat(43);
		const { manager, relayLinks, store } = harness({
			cloudEnabled: true,
			devices: [
				{ id: pairingId, name: "mobile-3f9c2a", mobileSecretHash: "h", mobileIdentityKey: phoneKey, createdAt: 1 },
			],
		});
		store.putRelaySecret(pairingId, "relay-secret");
		await manager.restore();
		const connection = {
			onEvent: () => () => undefined,
			getSnapshot: () => ({ state: "online", peerIdentityKey: phoneKey, peerDeviceName: "Xiaomi 14" }),
			deliverEvent: async () => undefined,
			close: async () => undefined,
		} as unknown as RemoteConnection;
		relayLinks[0]?.options.onConnection(connection);
		await vi.waitFor(() => expect(manager.getState().devices[0]?.name).toBe("Xiaomi 14"));
		await manager.shutdown();
	});

	it("keeps a name chosen on the desktop when the phone connects", async () => {
		const pairingId = "a".repeat(24);
		const phoneKey = "k".repeat(43);
		const { manager, relayLinks, store } = harness({
			cloudEnabled: true,
			devices: [{ id: pairingId, name: "Pixel", mobileSecretHash: "h", mobileIdentityKey: phoneKey, createdAt: 1 }],
		});
		store.putRelaySecret(pairingId, "relay-secret");
		await manager.restore();
		await manager.renameDevice(pairingId, "工作手机");
		const delivered: string[] = [];
		const connection = {
			onEvent: () => () => undefined,
			getSnapshot: () => ({ state: "online", peerIdentityKey: phoneKey, peerDeviceName: "Xiaomi 14" }),
			deliverEvent: async (event: { name: string }) => {
				delivered.push(event.name);
			},
			close: async () => undefined,
		} as unknown as RemoteConnection;
		relayLinks[0]?.options.onConnection(connection);
		await vi.waitFor(() => expect(delivered).toContain("device.status"));
		expect(manager.getState().devices[0]?.name).toBe("工作手机");
		await manager.shutdown();
	});

	it("shares the screen only with a phone allowed to control the desktop, and tells it", async () => {
		const pairingId = "a".repeat(24);
		const phoneKey = "k".repeat(43);
		const { manager, relayLinks, store, desktopHosts } = harness({
			cloudEnabled: true,
			relayBaseUrl: "wss://relay.example",
			devices: [{ id: pairingId, name: "Pixel", mobileSecretHash: "h", mobileIdentityKey: phoneKey, createdAt: 1 }],
		});
		store.putRelaySecret(pairingId, "relay-secret");
		await manager.restore();
		const statuses: unknown[] = [];
		const connection = {
			onEvent: () => () => undefined,
			getSnapshot: () => ({ state: "online", peerIdentityKey: phoneKey }),
			deliverEvent: async (event: { name: string; payload?: unknown }) => {
				if (event.name === "device.status") statuses.push(event.payload);
			},
			close: async () => undefined,
		} as unknown as RemoteConnection;
		relayLinks[0]?.options.onConnection(connection);
		await vi.waitFor(() => expect(statuses).toHaveLength(1));
		expect(statuses[0]).toMatchObject({ desktopControl: false });
		expect(desktopHosts).toHaveLength(0);
		expect(manager.getState().devices[0]?.desktopControl).toBe(false);

		await manager.setDesktopControl(pairingId, true);
		await vi.waitFor(() => expect(desktopHosts).toHaveLength(1));
		expect(statuses.at(-1)).toMatchObject({ desktopControl: true });
		expect(manager.getState().devices[0]?.desktopControl).toBe(true);

		await manager.setDesktopControl(pairingId, false);
		expect(desktopHosts[0]?.stopped).toBe(true);
		expect(statuses.at(-1)).toMatchObject({ desktopControl: false });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(desktopHosts).toHaveLength(1);
		await manager.shutdown();
	});

	it("starts the desktop screen host when a paired phone comes online", async () => {
		const pairingId = "a".repeat(24);
		const phoneKey = "k".repeat(43);
		const { manager, relayLinks, store, desktopHosts } = harness({
			cloudEnabled: true,
			relayBaseUrl: "wss://relay.example",
			devices: [
				{
					id: pairingId,
					name: "iPhone",
					mobileSecretHash: "h",
					mobileIdentityKey: phoneKey,
					createdAt: 1,
					desktopControl: true,
				},
			],
		});
		store.putRelaySecret(pairingId, "relay-secret");
		await manager.restore();

		const connection = {
			onEvent: () => () => undefined,
			getSnapshot: () => ({ state: "online", peerIdentityKey: phoneKey }),
			close: async () => undefined,
		} as unknown as RemoteConnection;
		relayLinks[0]?.options.onConnection(connection);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(desktopHosts).toHaveLength(1);
		expect(desktopHosts[0]?.options).toEqual({
			relayBaseUrl: "wss://relay.example",
			pairingId,
			desktopSecret: "relay-secret",
		});
		desktopHosts[0]?.controlHandlers?.onClose("ICE failed");
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(desktopHosts[0]?.stopped).toBe(true);
		expect(desktopHosts).toHaveLength(2);
		await manager.shutdown();
		expect(desktopHosts[1]?.stopped).toBe(true);
	});
});
