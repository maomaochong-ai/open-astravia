import type {
	RemoteDevicePaired,
	RemoteInviteEnvelope,
	RemoteSealed,
	RemoteTransportHandlers,
} from "@vetta/remote-control";
import {
	FakeRelay,
	FakeTransport,
	generateIdentityKeyPair,
	inviteBoxId,
	normalizeInviteCode,
	openInvite,
	parseInviteQr,
	parsePairingUri,
	RemoteConnection,
	type RemoteHello,
	readDevicePaired,
	toBase64Url,
} from "@vetta/remote-control";
import { describe, expect, it, vi } from "vitest";
import type { DesktopConfig } from "../config/desktop-config-store.js";
import type { CredentialRef } from "../credentials/credential-vault.js";
import { DesktopRemoteAccessManager, type RemoteAccessState } from "./desktop-remote-access-manager.js";
import type { DesktopRemoteLanServerOptions } from "./desktop-remote-lan-server.js";
import type { DesktopRemoteMirror } from "./desktop-remote-mirror.js";
import type { DesktopRemoteRelayLinkOptions } from "./desktop-remote-relay-link.js";
import { RemoteDeviceStore } from "./remote-device-store.js";
import type { RemoteRelayProbeResult } from "./remote-relay-probe.js";

function key(ref: CredentialRef): string {
	return `${ref.namespace}/${ref.ownerId}/${ref.name}`;
}

function harness(
	initial?: DesktopConfig["remoteControl"],
	options: { hubGraceMs?: number; probeRelay?: (url: string) => Promise<RemoteRelayProbeResult> } = {},
) {
	let config: DesktopConfig = {
		projects: [],
		archivedProjects: [],
		remoteControl: initial,
	} as unknown as DesktopConfig;
	const vault = new Map<string, string>();
	let writesFail = false;
	let removalsFail = false;
	let writeCount = 0;
	const store = new RemoteDeviceStore({
		readConfig: async () => structuredClone(config),
		updateConfig: async (update) => {
			if (writesFail) throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
			const next = await update(structuredClone(config));
			config = structuredClone(next);
			writeCount += 1;
			return structuredClone(config);
		},
		vault: {
			isAvailable: () => true,
			get: (ref) => vault.get(key(ref)),
			put: (ref, value) => void vault.set(key(ref), value),
			remove: (ref) => {
				if (removalsFail) throw new Error("credential store temporarily unavailable");
				vault.delete(key(ref));
			},
		},
		defaultRelayBaseUrl: "wss://relay.example",
	});
	const lanServers: Array<{ options: DesktopRemoteLanServerOptions; started: boolean; stopped: boolean }> = [];
	const relayLinks: Array<{ options: DesktopRemoteRelayLinkOptions; started: boolean; stopped: boolean }> = [];
	const notifications: string[] = [];
	const mirrors: Array<{ started: boolean; stopped: boolean }> = [];
	const desktopHosts: Array<{
		options: { relayBaseUrl: string; pairingId: string; desktopSecret: string; screenOnDemand: boolean };
		stopped: boolean;
		controlHandlers?: RemoteTransportHandlers;
		/** Every `setScreen` call, in order. */
		screen: boolean[];
	}> = [];
	const permissions = { screen: true, input: true };
	const mailbox = {
		published: [] as Array<{ boxUrl: string; token: string; envelope: RemoteInviteEnvelope; ttlMs: number }>,
		withdrawn: [] as string[],
		refuse: false,
		/** Keeps a publish waiting until it settles. */
		hold: undefined as Promise<void> | undefined,
	};
	const manager = new DesktopRemoteAccessManager({
		store,
		deviceId: "desktop-1",
		deviceName: "MacBook",
		runningSessionCount: () => 0,
		listLanEndpoints: (port) => [`192.168.1.20:${port}`],
		notifications: {
			deviceConnected: (device) => notifications.push(`connected:${device.name}`),
			pairingRequested: (request) => notifications.push(`pairing:${request.deviceName}:${request.code}`),
			screenPermissionMissing: (request) =>
				notifications.push(`screen-permission:${request.deviceName}:${request.screen}:${request.input}`),
		},
		screenPermissions: { screenAllowed: () => permissions.screen, inputAllowed: () => permissions.input },
		screenPermissionPollMs: 10,
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
				const entry: (typeof desktopHosts)[number] = { options, stopped: false, screen: [] };
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
					setScreen: async (active: boolean) => {
						entry.screen.push(active);
						return active;
					},
					refreshInput: () => true,
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
		inviteMailbox: {
			publish: async (boxUrl, token, envelope, ttlMs) => {
				await mailbox.hold;
				if (mailbox.refuse) throw new Error("relay not deployed");
				mailbox.published.push({ boxUrl, token, envelope, ttlMs });
			},
			withdraw: async (boxUrl) => {
				mailbox.withdrawn.push(boxUrl);
			},
		},
		inviteTtlMs: 60_000,
		hubGraceMs: options.hubGraceMs ?? 5,
		probeRelay: options.probeRelay,
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
		permissions,
		mailbox,
		readConfig: () => config,
		writeCount: () => writeCount,
		/** Makes saving the desktop config fail, as a locked file on Windows does. */
		failSecretRemoval: (fail: boolean) => {
			removalsFail = fail;
		},
		failWrites: (fail: boolean) => {
			writesFail = fail;
		},
	};
}

async function connectPhone(
	h: ReturnType<typeof harness>,
	pairingId: string,
	identity = generateIdentityKeyPair(),
	name = "iPhone",
	holdEncrypted = false,
) {
	const options = h.lanServers[0]!.options;
	const credential = options.lookupDevice(pairingId);
	if (!credential) throw new Error("unknown pairing");
	const phoneTransport = new FakeTransport();
	const desktopTransport = new FakeTransport();
	phoneTransport.connectPeer(desktopTransport);
	const held: RemoteSealed[] = [];
	const send = phoneTransport.send.bind(phoneTransport);
	if (holdEncrypted)
		phoneTransport.send = async (frame) => {
			if (frame.type === "sealed") held.push(frame);
			else await send(frame);
		};
	const release = async () => {
		phoneTransport.send = send;
		for (const frame of held) await send(frame);
	};
	const connection = new RemoteConnection(desktopTransport, {
		role: "desktop",
		handshake: "accept",
		deviceId: "desktop",
		deviceName: "MacBook",
		identity: options.identity,
		capabilities: { chat: true, sessionRead: true },
		journal: options.journalFor(pairingId),
		onHello: (frame) => options.onDeviceHello(credential, frame),
	});
	const phone = new RemoteConnection(phoneTransport, {
		role: "mobile",
		deviceId: "phone",
		deviceName: name,
		identity,
		capabilities: { chat: true, sessionRead: true },
		expectedPeerIdentityKey: options.identity.publicKey,
	});
	options.onAccepted(
		{ type: "device", id: pairingId },
		{ connection, peerIdentityKey: () => connection.getSnapshot().peerIdentityKey },
	);
	await connection.connect();
	await phone.connect();
	return { phone, connection, release };
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
	it("sends initialization to the reconnecting phone while an old link still appears online", async () => {
		const pairingId = "a".repeat(24);
		const phoneIdentity = generateIdentityKeyPair();
		const { manager, relayLinks, store } = harness({
			cloudEnabled: true,
			devices: [
				{
					id: pairingId,
					name: "iPhone",
					mobileSecretHash: "h",
					mobileIdentityKey: toBase64Url(phoneIdentity.publicKey),
					createdAt: 1,
				},
			],
		});
		store.putRelaySecret(pairingId, "relay-secret");
		await manager.restore();
		const options = relayLinks[0]!.options;
		const phones: RemoteConnection[] = [];
		const open = async (resumeFrom: number) => {
			const phoneTransport = new FakeTransport();
			const desktopTransport = new FakeTransport();
			phoneTransport.connectPeer(desktopTransport);
			const connection = new RemoteConnection(desktopTransport, {
				role: "desktop",
				handshake: "accept",
				deviceId: "desktop",
				deviceName: "MacBook",
				identity: options.identity,
				capabilities: { chat: true, sessionRead: true, screen: true },
				journal: options.journal,
				expectedPeerIdentityKey: phoneIdentity.publicKey,
				onHello: () => ({ kind: "approve" }),
			});
			const phone = new RemoteConnection(phoneTransport, {
				role: "mobile",
				deviceId: "phone",
				deviceName: "iPhone",
				identity: phoneIdentity,
				capabilities: { chat: true, sessionRead: true, screen: true },
				resumeFrom,
				expectedPeerIdentityKey: options.identity.publicKey,
			});
			phones.push(phone);
			const statuses: number[] = [];
			phone.onEvent((event) => {
				if (event.type === "remote-event" && event.event.name === "device.status")
					statuses.push(event.event.sequence);
			});
			options.onConnection(connection);
			await connection.connect();
			await phone.connect();
			return { phone, statuses };
		};
		try {
			const previous = await open(0);
			await vi.waitFor(() => expect(previous.statuses).toHaveLength(1));
			const resumed = await open(previous.statuses[0]!);
			// The previous process vanished without closing its transport. Its route
			// still wins ordinary traffic, but cannot receive this phone's bootstrap.
			await vi.waitFor(() => expect(resumed.statuses).toHaveLength(1));
			expect(resumed.statuses[0]).toBeGreaterThan(previous.statuses[0]!);
			await expect(resumed.phone.request("screen.subscribe", { active: true })).resolves.toMatchObject({
				screen: "streaming",
			});
			await expect(resumed.phone.request("screen.subscribe", { active: false })).resolves.toMatchObject({
				screen: "stopped",
			});
		} finally {
			await manager.shutdown();
			for (const phone of phones) await phone.close();
		}
	});

	it("starts nothing when no phone is paired", async () => {
		const { manager, lanServers, relayLinks, vault } = harness();
		await manager.restore();
		expect(lanServers).toEqual([]);
		expect(relayLinks).toEqual([]);
		expect(vault.size).toBe(0);
		expect(manager.getState()).toMatchObject({ devices: [], approvals: [], lanEndpoints: [], cloudEnabled: true });
	});

	it("creates an invitation separate from devices and claims only an authenticated phone", async () => {
		const h = harness();
		const { manager, lanServers, relayLinks, readConfig, store } = h;
		const state = await manager.createInvite();
		const invite = parsePairingUri(state.invite!.inviteUri);
		expect(state.devices).toEqual([]);
		expect(invite.lanEndpoints).toEqual(["192.168.1.20:43117"]);
		expect(relayLinks[0]?.options.mobileSecretHash).toBe(
			readConfig().remoteControl?.pendingPairings?.[0]?.mobileSecretHash,
		);
		const identity = generateIdentityKeyPair();
		const phoneKey = toBase64Url(identity.publicKey);
		const credential = lanServers[0]!.options.lookupDevice(invite.pairingId)!;
		expect(lanServers[0]!.options.onDeviceHello(credential, hello(phoneKey))).toEqual({ kind: "approve" });
		expect(manager.getState().devices).toEqual([]);
		expect(store.mobileSecret(invite.pairingId)).toBe(invite.mobileSecret);
		await connectPhone(h, invite.pairingId, identity);
		await vi.waitFor(() => expect(manager.getState().devices).toHaveLength(1));
		expect(readConfig().remoteControl?.devices[0]).toMatchObject({
			pairingId: invite.pairingId,
			mobileIdentityKey: phoneKey,
			name: "iPhone",
		});
		expect(store.mobileSecret(invite.pairingId)).toBeUndefined();
		expect(manager.getState().invite).toBeUndefined();
		expect(relayLinks[0]?.stopped).toBe(true);
		expect(relayLinks[1]?.options.mobileIdentityKey).toBe(phoneKey);
		await manager.shutdown();
	});

	it("offers the invite as a connection code and password that open it from the relay", async () => {
		const h = harness();
		const { manager, mailbox } = h;
		const created = await manager.createInvite();
		await vi.waitFor(() => expect(manager.getState().invite?.code?.status).toBe("ready"));
		const view = manager.getState().invite?.code;
		expect(view?.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
		expect(view?.password).toMatch(/^\d{6}$/);
		const code = normalizeInviteCode(view?.code ?? "") ?? "";
		expect(mailbox.published).toHaveLength(1);
		const published = mailbox.published[0];
		expect(published?.boxUrl).toBe(`https://relay.example/v2/invite/${inviteBoxId(code)}`);
		expect(published?.ttlMs).toBeLessThanOrEqual(60_000);
		expect(JSON.stringify(published?.envelope)).not.toContain(
			parsePairingUri(created.invite?.inviteUri ?? "").mobileSecret,
		);
		await expect(openInvite(published!.envelope, code, view?.password ?? "")).resolves.toBe(
			created.invite?.inviteUri,
		);
		// The QR code carries only the code and password; the default relay goes unnamed.
		expect(parseInviteQr(manager.getState().invite?.qrText ?? "")).toEqual({ code, password: view?.password });

		// Claimed by the first phone: the mailbox is emptied.
		const invite = parsePairingUri(created.invite?.inviteUri ?? "");
		await connectPhone(h, invite.pairingId);
		await vi.waitFor(() => expect(mailbox.withdrawn).toEqual([published?.boxUrl]));
		await manager.shutdown();
	});

	it("keeps the QR code when the relay cannot take the connection code, and withdraws a discarded one", async () => {
		const { manager, mailbox } = harness();
		mailbox.refuse = true;
		await manager.createInvite();
		await vi.waitFor(() => expect(manager.getState().invite?.code?.status).toBe("failed"));
		expect(manager.getState().invite?.inviteUri).toBeTruthy();
		expect(manager.getState().invite?.qrText).toBe(manager.getState().invite?.inviteUri);

		mailbox.refuse = false;
		await manager.createInvite();
		await vi.waitFor(() => expect(manager.getState().invite?.code?.status).toBe("ready"));
		await manager.cancelInvite();
		await vi.waitFor(() => expect(mailbox.withdrawn).toContain(mailbox.published[0]?.boxUrl));
		await manager.shutdown();
	});

	it("does not offer a connection code without the relay", async () => {
		const { manager, mailbox } = harness();
		await manager.setCloudEnabled(false);
		await manager.createInvite();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(manager.getState().invite?.code).toBeUndefined();
		expect(manager.getState().invite?.qrText).toBe(manager.getState().invite?.inviteUri);
		expect(mailbox.published).toHaveLength(0);
		await manager.shutdown();
	});

	it("shows no QR code until the connection code is on the relay, so the code does not change under the camera", async () => {
		const { manager, mailbox } = harness();
		let release!: () => void;
		mailbox.hold = new Promise((resolve) => {
			release = resolve;
		});
		await manager.createInvite();
		await vi.waitFor(() => expect(manager.getState().invite?.code?.status).toBe("preparing"));
		expect(manager.getState().invite?.qrText).toBeUndefined();

		release();
		await vi.waitFor(() => expect(manager.getState().invite?.code?.status).toBe("ready"));
		expect(manager.getState().invite?.qrText).toMatch(/^VETTA:\/\/PAIR\//);
		await manager.shutdown();
	});

	it("names a relay other than the default in the QR code", async () => {
		const { manager } = harness();
		await manager.setRelayBaseUrl("wss://relay.mine.test");
		await manager.createInvite();
		await vi.waitFor(() => expect(manager.getState().invite?.code?.status).toBe("ready"));
		expect(parseInviteQr(manager.getState().invite?.qrText ?? "")?.relayBaseUrl).toBe("wss://relay.mine.test");
		await manager.shutdown();
	});

	it("a phone that scans again keeps its device identity and settings while retiring its old pairing", async () => {
		const identity = generateIdentityKeyPair();
		const phoneKey = toBase64Url(identity.publicKey);
		const oldId = "o".repeat(24);
		const h = harness({
			cloudEnabled: true,
			devices: [
				{
					id: oldId,
					name: "Work phone",
					renamed: true,
					desktopControl: false,
					mobileSecretHash: "h",
					mobileIdentityKey: phoneKey,
					createdAt: 1,
				},
			],
		});
		const { manager, store, readConfig, vault, lanServers } = h;
		store.putRelaySecret(oldId, "old-relay-secret");
		await manager.restore();
		const old = await connectPhone(h, oldId, identity);
		await vi.waitFor(() => expect(manager.getState().devices[0]?.online).toBe(true));
		const state = await manager.createInvite();
		const invite = parsePairingUri(state.invite!.inviteUri);
		expect(manager.getState().devices).toHaveLength(1);
		const fresh = await connectPhone(h, invite.pairingId, identity);
		await vi.waitFor(() => expect(readConfig().remoteControl?.devices[0]?.pairingId).toBe(invite.pairingId));
		expect(manager.getState().devices).toEqual([
			expect.objectContaining({ id: oldId, name: "Work phone", desktopControl: false, createdAt: 1 }),
		]);
		await vi.waitFor(() => expect(old.connection.getSnapshot().state).toBe("closed"));
		expect(lanServers[0]!.options.lookupDevice(oldId)).toBeUndefined();
		expect([...vault.keys()].filter((name) => name.includes(oldId))).toEqual([]);
		await expect(fresh.phone.request("screen.subscribe", { active: true })).rejects.toThrow(/does not share/);
		// Public device actions still address the stable device after the pairing changed.
		await manager.renameDevice(oldId, "Renamed");
		await manager.setDesktopControl(oldId, true);
		expect(readConfig().remoteControl?.devices[0]).toMatchObject({
			id: oldId,
			pairingId: invite.pairingId,
			name: "Renamed",
			desktopControl: true,
		});
		const other = await manager.createInvite();
		await connectPhone(h, other.invite!.pairingId, generateIdentityKeyPair(), "Renamed");
		await vi.waitFor(() => expect(manager.getState().devices).toHaveLength(2));
		await manager.revokeDevice(oldId);
		expect(lanServers[0]!.options.lookupDevice(invite.pairingId)).toBeUndefined();
		expect(manager.getState().devices).toHaveLength(1);
		await manager.shutdown();
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

	it("pushes relay disconnect and reconnect to settings and releases the idle mirror", async () => {
		vi.useFakeTimers();
		const pairingId = "a".repeat(24);
		const phoneIdentity = generateIdentityKeyPair();
		const { manager, relayLinks, store, mirrors } = harness(
			{
				cloudEnabled: true,
				devices: [
					{
						id: pairingId,
						name: "Phone",
						mobileSecretHash: "h",
						mobileIdentityKey: toBase64Url(phoneIdentity.publicKey),
						createdAt: 1,
					},
				],
			},
			{ hubGraceMs: 5_000 },
		);
		const states: RemoteAccessState[] = [];
		const unsubscribe = manager.onStateChanged((state) => states.push(state));
		let phone: RemoteConnection | undefined;
		try {
			store.putRelaySecret(pairingId, "relay-secret");
			await manager.restore();
			const options = relayLinks[0]!.options;
			const relay = new FakeRelay();
			const host = new RemoteConnection(relay.createTransport(pairingId, "desktop"), {
				...options,
				role: "desktop",
				capabilities: { chat: true, sessionRead: true },
				expectedPeerIdentityKey: phoneIdentity.publicKey,
			});
			phone = new RemoteConnection(relay.createTransport(pairingId, "mobile"), {
				role: "mobile",
				deviceId: "phone",
				deviceName: "Phone",
				capabilities: { chat: true, sessionRead: true },
				identity: phoneIdentity,
				expectedPeerIdentityKey: options.identity.publicKey,
			});
			options.onConnection(host);
			await host.connect();
			await phone.connect();
			await vi.advanceTimersByTimeAsync(1);
			expect(states.at(-1)?.devices[0]).toMatchObject({ online: true, channels: ["relay"] });
			expect(mirrors.at(-1)).toEqual({ started: true, stopped: false });
			await expect(phone.request("session.list")).resolves.toEqual({});

			await phone.close();
			await vi.advanceTimersByTimeAsync(5_001);
			expect(states.at(-1)?.devices[0]).toMatchObject({ online: false, channels: [] });
			expect(mirrors.at(-1)?.stopped).toBe(true);
			expect(relayLinks[0]?.stopped).toBe(false);

			await phone.connect();
			await vi.advanceTimersByTimeAsync(1);
			expect(states.at(-1)?.devices[0]).toMatchObject({ online: true, channels: ["relay"] });
			expect(mirrors.at(-1)).toEqual({ started: true, stopped: false });
			await expect(phone.request("session.list")).resolves.toEqual({});
		} finally {
			unsubscribe();
			await manager.shutdown();
			await phone?.close();
			vi.useRealTimers();
		}
	});

	it("revoking the last phone tears every transport down again", async () => {
		const { manager, lanServers, relayLinks, vault, readConfig } = harness();
		const state = await manager.createInvite();
		const id = state.invite!.pairingId;
		await manager.cancelInvite();
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

	it("shares the screen with a phone until it is turned off for it, and tells the phone", async () => {
		const pairingId = "a".repeat(24);
		const phoneKey = "k".repeat(43);
		const { manager, relayLinks, store, desktopHosts, readConfig } = harness({
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
		await vi.waitFor(() => expect(desktopHosts).toHaveLength(1));
		// The phone learns here, not from the handshake, that it may ask for files (ADR-0139).
		expect(statuses[0]).toMatchObject({ desktopControl: true, fileRead: true });
		expect(manager.getState().devices[0]?.desktopControl).toBe(true);

		await manager.setDesktopControl(pairingId, false);
		expect(desktopHosts[0]?.stopped).toBe(true);
		expect(statuses.at(-1)).toMatchObject({ desktopControl: false });
		expect(readConfig().remoteControl?.devices[0]?.desktopControl).toBe(false);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(desktopHosts).toHaveLength(1);

		await manager.setDesktopControl(pairingId, true);
		await vi.waitFor(() => expect(desktopHosts).toHaveLength(2));
		expect(statuses.at(-1)).toMatchObject({ desktopControl: true });
		await manager.shutdown();
	});

	it("moves to another relay, telling connected phones the new address first", async () => {
		const pairingId = "a".repeat(24);
		const phoneKey = "k".repeat(43);
		const { manager, relayLinks, store, readConfig } = harness({
			cloudEnabled: true,
			devices: [{ id: pairingId, name: "Pixel", mobileSecretHash: "h", mobileIdentityKey: phoneKey, createdAt: 1 }],
		});
		store.putRelaySecret(pairingId, "relay-secret");
		await manager.restore();
		const events: Array<{ name: string; relayLinksAtThatTime: number; payload?: unknown }> = [];
		const connection = {
			onEvent: () => () => undefined,
			getSnapshot: () => ({ state: "online", peerIdentityKey: phoneKey }),
			deliverEvent: async (event: { name: string; payload?: unknown }) => {
				events.push({
					name: event.name,
					payload: event.payload,
					relayLinksAtThatTime: relayLinks.filter((l) => !l.stopped).length,
				});
			},
			close: async () => undefined,
		} as unknown as RemoteConnection;
		relayLinks[0]?.options.onConnection(connection);
		await vi.waitFor(() => expect(events).toHaveLength(1));
		expect(events[0]?.payload).toMatchObject({ relayBaseUrl: "wss://relay.example" });

		await expect(manager.setRelayBaseUrl("not a url")).rejects.toThrow();
		const moved = await manager.setRelayBaseUrl("https://relay.mine.test/");
		expect(moved.relayBaseUrl).toBe("wss://relay.mine.test");
		expect(moved.defaultRelayBaseUrl).toBe("wss://relay.example");
		expect(readConfig().remoteControl?.relayBaseUrl).toBe("wss://relay.mine.test");
		const told = events.at(-1);
		expect(told?.payload).toMatchObject({ relayBaseUrl: "wss://relay.mine.test" });
		expect(told?.relayLinksAtThatTime).toBe(1);
		expect(relayLinks[0]?.stopped).toBe(true);
		expect(relayLinks.at(-1)?.options.relayBaseUrl).toBe("wss://relay.mine.test");

		const restored = await manager.setRelayBaseUrl(undefined);
		expect(restored.relayBaseUrl).toBe("wss://relay.example");
		expect(readConfig().remoteControl?.relayBaseUrl).toBeUndefined();
		await manager.shutdown();
	});

	it("checks a relay address before it is used", async () => {
		const probed: string[] = [];
		const { manager } = harness(undefined, {
			probeRelay: async (url) => {
				probed.push(url);
				return "noInviteCodes";
			},
		});
		await expect(manager.testRelay("relay.bad url")).resolves.toBe("unreachable");
		await expect(manager.testRelay("https://relay.mine.test")).resolves.toBe("noInviteCodes");
		expect(probed).toEqual(["wss://relay.mine.test"]);
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
			screenOnDemand: false,
		});
		desktopHosts[0]?.controlHandlers?.onClose("ICE failed");
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(desktopHosts[0]?.stopped).toBe(true);
		expect(desktopHosts).toHaveLength(2);
		await manager.shutdown();
		expect(desktopHosts[1]?.stopped).toBe(true);
	});

	describe("screen on demand (ADR-0140)", () => {
		const pairingId = "a".repeat(24);
		const phoneKey = "k".repeat(43);
		const paired = {
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
		};

		/** A phone link that can send requests and records what the desktop sends back. */
		/** `capabilities` undefined: the desktop's end of a relay link, which never sees the phone's hello. */
		function phoneLink(capabilities: { chat: boolean; sessionRead: boolean; screen?: boolean } | undefined) {
			let listener: ((event: unknown) => void) | undefined;
			const responses: Array<{
				requestId: string;
				response: { success: boolean; payload?: unknown; error?: unknown };
			}> = [];
			const events: Array<{ name: string; payload?: unknown }> = [];
			const connection = {
				onEvent: (next: (event: unknown) => void) => {
					listener = next;
					return () => undefined;
				},
				getSnapshot: () => ({ state: "online", peerIdentityKey: phoneKey, peerCapabilities: capabilities }),
				deliverEvent: async (event: { name: string; payload?: unknown }) => {
					events.push(event);
				},
				respond: async (requestId: string, response: { success: boolean; payload?: unknown }) => {
					responses.push({ requestId, response });
				},
				close: async () => undefined,
			} as unknown as RemoteConnection;
			let requests = 0;
			const subscribe = async (active: unknown) => {
				const requestId = `r${++requests}`;
				listener?.({
					type: "remote-request",
					request: { type: "request", requestId, method: "screen.subscribe", payload: { active } },
				});
				await vi.waitFor(() => expect(responses.some((entry) => entry.requestId === requestId)).toBe(true));
				return responses.find((entry) => entry.requestId === requestId)?.response;
			};
			return { connection, events, subscribe };
		}

		it("captures for a phone that declared screen only while it subscribes, and says it can", async () => {
			const { manager, relayLinks, store, desktopHosts } = harness(structuredClone(paired));
			store.putRelaySecret(pairingId, "relay-secret");
			await manager.restore();
			const phone = phoneLink({ chat: true, sessionRead: true, screen: true });
			relayLinks[0]?.options.onConnection(phone.connection);
			await vi.waitFor(() => expect(desktopHosts).toHaveLength(1));
			expect(desktopHosts[0]?.options.screenOnDemand).toBe(true);
			expect(phone.events.find((event) => event.name === "device.status")?.payload).toMatchObject({ screen: true });
			expect(desktopHosts[0]?.screen).toEqual([]);

			await expect(phone.subscribe(true)).resolves.toEqual({
				success: true,
				payload: { screen: "streaming", input: "ready" },
			});
			await expect(phone.subscribe(false)).resolves.toEqual({
				success: true,
				payload: { screen: "stopped", input: "ready" },
			});
			expect(desktopHosts[0]?.screen).toEqual([true, false]);
			await manager.shutdown();
		});

		it("learns from a subscription over the relay that the phone captures on demand, and remembers it", async () => {
			const { manager, relayLinks, store, desktopHosts, readConfig } = harness(structuredClone(paired));
			store.putRelaySecret(pairingId, "relay-secret");
			await manager.restore();
			const phone = phoneLink(undefined);
			relayLinks[0]?.options.onConnection(phone.connection);
			await vi.waitFor(() => expect(desktopHosts).toHaveLength(1));
			expect(desktopHosts[0]?.options.screenOnDemand).toBe(false);

			await phone.subscribe(true);
			expect(readConfig().remoteControl?.devices[0]?.screenOnDemand).toBe(true);
			expect(desktopHosts[0]?.stopped).toBe(true);
			desktopHosts[0]?.controlHandlers?.onClose("host stopped");
			await vi.waitFor(() => expect(desktopHosts).toHaveLength(2));
			expect(desktopHosts[1]?.options.screenOnDemand).toBe(true);
			// The new host picks up the subscription made meanwhile.
			await vi.waitFor(() => expect(desktopHosts[1]?.screen).toEqual([true]));
			await manager.shutdown();
		});

		it("keeps sharing for the whole session with a phone that does not declare screen", async () => {
			const { manager, relayLinks, store, desktopHosts } = harness(structuredClone(paired));
			store.putRelaySecret(pairingId, "relay-secret");
			await manager.restore();
			relayLinks[0]?.options.onConnection(phoneLink({ chat: true, sessionRead: true }).connection);
			await vi.waitFor(() => expect(desktopHosts).toHaveLength(1));
			expect(desktopHosts[0]?.options.screenOnDemand).toBe(false);
			await manager.shutdown();
		});

		it("explains a missing permission, asks the desktop to grant it, and follows up when it is granted", async () => {
			const { manager, relayLinks, store, desktopHosts, permissions, notifications } = harness(
				structuredClone(paired),
			);
			permissions.screen = false;
			store.putRelaySecret(pairingId, "relay-secret");
			await manager.restore();
			const phone = phoneLink({ chat: true, sessionRead: true, screen: true });
			relayLinks[0]?.options.onConnection(phone.connection);
			await vi.waitFor(() => expect(desktopHosts).toHaveLength(1));

			await expect(phone.subscribe(true)).resolves.toMatchObject({
				payload: { screen: "permission_denied", input: "ready" },
			});
			expect(desktopHosts[0]?.screen).toEqual([]);
			expect(notifications).toContain("screen-permission:iPhone:true:false");

			permissions.screen = true;
			await vi.waitFor(() =>
				expect(phone.events.find((event) => event.name === "screen.status")?.payload).toEqual({
					screen: "streaming",
					input: "ready",
				}),
			);
			await manager.shutdown();
		});

		it("refuses the screen to a phone it was turned off for, and stops capturing when it is", async () => {
			const { manager, relayLinks, store, desktopHosts } = harness(structuredClone(paired));
			store.putRelaySecret(pairingId, "relay-secret");
			await manager.restore();
			const phone = phoneLink({ chat: true, sessionRead: true, screen: true });
			relayLinks[0]?.options.onConnection(phone.connection);
			await vi.waitFor(() => expect(desktopHosts).toHaveLength(1));
			await phone.subscribe(true);

			await manager.setDesktopControl(pairingId, false);
			expect(desktopHosts[0]?.stopped).toBe(true);
			await expect(phone.subscribe(true)).resolves.toMatchObject({
				success: false,
				error: { code: "forbidden" },
			});
			await expect(phone.subscribe("yes")).resolves.toMatchObject({
				success: false,
				error: { code: "invalid_frame" },
			});
			await manager.shutdown();
		});
	});
});

describe("device identity survives pairing replacement", () => {
	function pairedPhone() {
		const identity = generateIdentityKeyPair();
		const h = harness({
			cloudEnabled: false,
			devices: [
				{
					id: "stable-phone",
					pairingId: "old-pairing",
					name: "My phone",
					renamed: true,
					desktopControl: false,
					mobileSecretHash: "old-hash",
					mobileIdentityKey: toBase64Url(identity.publicKey),
					createdAt: 1,
				},
			],
		});
		h.store.putRelaySecret("old-pairing", "old-relay");
		return { h, identity };
	}

	it("re-pairing the same identity keeps the device and permissions across restart", async () => {
		const { h, identity } = pairedPhone();
		await h.manager.restore();
		const old = await connectPhone(h, "old-pairing", identity);
		const revoked: string[] = [];
		old.phone.onEvent((event) => {
			if (event.type === "remote-event") revoked.push(event.event.name);
		});
		const state = await h.manager.createInvite();
		expect(h.lanServers[0]!.options.lookupDevice("old-pairing")).toBeDefined();
		const freshIdentity = identity;
		const fresh = await connectPhone(h, state.invite!.pairingId, freshIdentity);
		await vi.waitFor(() => expect(h.readConfig().remoteControl?.devices[0]?.pairingId).toBe(state.invite!.pairingId));
		expect(h.manager.getState().devices).toEqual([
			expect.objectContaining({ id: "stable-phone", name: "My phone", desktopControl: false, createdAt: 1 }),
		]);
		await vi.waitFor(() => expect(old.connection.getSnapshot().state).toBe("closed"));
		expect(revoked).not.toContain("device.revoked");
		expect(h.store.relaySecret("old-pairing")).toBeUndefined();
		await expect(
			h.store.patchDevice("stable-phone", { name: "Stale name", screenOnDemand: true }, "old-pairing"),
		).resolves.toBeUndefined();
		expect(h.manager.getState().devices[0]?.name).toBe("My phone");
		await expect(fresh.phone.request("screen.subscribe", { active: true })).rejects.toThrow(/does not share/);
		await h.manager.shutdown();
		const restarted = harness(h.readConfig().remoteControl);
		for (const [key, value] of h.vault) restarted.vault.set(key, value);
		await restarted.manager.restore();
		expect(restarted.manager.getState().devices[0]?.id).toBe("stable-phone");
		expect(restarted.lanServers[0]!.options.lookupDevice("old-pairing")).toBeUndefined();
		expect(restarted.lanServers[0]!.options.lookupDevice(state.invite!.pairingId)?.mobileIdentityKey).toBe(
			toBase64Url(freshIdentity.publicKey),
		);
		await restarted.manager.shutdown();
	});

	it("cancellation, expiration and failed saving leave the original pairing usable", async () => {
		const { h, identity } = pairedPhone();
		await h.manager.restore();
		const old = await connectPhone(h, "old-pairing", identity);
		await vi.waitFor(() => expect(h.manager.getState().devices[0]?.online).toBe(true));
		const pending = await h.manager.createInvite();
		const unproven = await connectPhone(h, pending.invite!.pairingId, generateIdentityKeyPair(), "Pending", true);
		await h.manager.cancelInvite();
		expect(unproven.connection.getSnapshot().state).toBe("closed");
		expect(h.lanServers[0]!.options.lookupDevice(pending.invite!.pairingId)).toBeUndefined();
		expect(h.store.mobileSecret(pending.invite!.pairingId)).toBeUndefined();
		const failed = await h.manager.createInvite();
		h.failWrites(true);
		const newcomer = await connectPhone(h, failed.invite!.pairingId, identity);
		await vi.waitFor(() => expect(newcomer.connection.getSnapshot().state).toBe("closed"));
		h.failWrites(false);
		expect(h.readConfig().remoteControl?.devices[0]?.pairingId).toBe("old-pairing");
		expect(old.connection.getSnapshot().state).toBe("online");
		expect(h.store.relaySecret("old-pairing")).toBe("old-relay");
		await expect(old.phone.request("screen.subscribe", { active: true })).rejects.toThrow(/does not share/);
		await h.manager.cancelInvite();
		vi.useFakeTimers();
		try {
			const expiring = await h.manager.createInvite();
			await vi.advanceTimersByTimeAsync(60_001);
			expect(h.manager.getState().invite).toBeUndefined();
			expect(h.lanServers[0]!.options.lookupDevice(expiring.invite!.pairingId)).toBeUndefined();
			expect(h.readConfig().remoteControl?.devices[0]?.pairingId).toBe("old-pairing");
		} finally {
			vi.useRealTimers();
			await h.manager.shutdown();
		}
	});

	it("a different identity with the same phone name stays separate and does not inherit permissions", async () => {
		const { h, identity } = pairedPhone();
		await h.manager.restore();
		const old = await connectPhone(h, "old-pairing", identity);
		const invite = await h.manager.createInvite();
		const newIdentity = generateIdentityKeyPair();
		await connectPhone(h, invite.invite!.pairingId, newIdentity, "My phone");
		await vi.waitFor(() => expect(h.manager.getState().devices).toHaveLength(2));
		expect(h.manager.getState().devices.find((device) => device.id === "stable-phone")).toMatchObject({
			desktopControl: false,
		});
		expect(h.manager.getState().devices.find((device) => device.id === invite.invite!.pairingId)).toMatchObject({
			name: "My phone",
			desktopControl: true,
		});
		expect(old.connection.getSnapshot().state).toBe("online");
		await h.manager.revokeDevice("stable-phone");
		expect(h.manager.getState().devices.map((device) => device.id)).toEqual([invite.invite!.pairingId]);
		await h.manager.shutdown();
	});

	it("restores one device per verified identity, keeps newest credentials and discards abandoned invitations", async () => {
		const identityKey = toBase64Url(generateIdentityKeyPair().publicKey);
		const otherKey = toBase64Url(generateIdentityKeyPair().publicKey);
		const h = harness({
			cloudEnabled: false,
			devices: [
				{
					id: "oldest",
					name: "Custom name",
					renamed: true,
					desktopControl: false,
					mobileSecretHash: "old",
					mobileIdentityKey: identityKey,
					createdAt: 1,
					lastSeenAt: 9,
				},
				{
					id: "newest",
					name: "Same name",
					mobileSecretHash: "new",
					mobileIdentityKey: identityKey,
					createdAt: 2,
					lastSeenAt: 3,
				},
				{ id: "other", name: "Same name", mobileSecretHash: "other", mobileIdentityKey: otherKey, createdAt: 3 },
				{ id: "abandoned-legacy", name: "", mobileSecretHash: "pending", createdAt: 4 },
			],
			retiredPairingIds: ["crash-before-cleanup"],
			pendingPairings: [
				{
					pairingId: "abandoned-new",
					mobileSecretHash: "pending",
					expiresAt: Date.now() + 60_000,
				},
			],
		});
		for (const id of ["oldest", "newest", "other", "abandoned-legacy", "abandoned-new", "crash-before-cleanup"])
			h.store.putRelaySecret(id, "relay");
		await h.manager.restore();
		expect(h.manager.getState().devices).toEqual([
			expect.objectContaining({ id: "oldest", name: "Custom name", desktopControl: false, createdAt: 1 }),
			expect.objectContaining({ id: "other" }),
		]);
		expect(h.readConfig().remoteControl?.devices[0]?.pairingId).toBe("newest");
		for (const id of ["oldest", "abandoned-legacy", "abandoned-new", "crash-before-cleanup"]) {
			expect(h.store.relaySecret(id)).toBeUndefined();
			expect(h.lanServers[0]!.options.lookupDevice(id)).toBeUndefined();
		}
		expect(h.store.relaySecret("newest")).toBe("relay");
		await h.manager.shutdown();
	});

	it("manual pairing keeps the old device until the phone receives and uses its new credential", async () => {
		const { h, identity } = pairedPhone();
		await h.manager.restore();
		const options = h.lanServers[0]!.options;
		const phoneTransport = new FakeTransport();
		const desktopTransport = new FakeTransport();
		phoneTransport.connectPeer(desktopTransport);
		const connection: RemoteConnection = new RemoteConnection(desktopTransport, {
			role: "desktop",
			handshake: "accept",
			deviceId: "desktop",
			deviceName: "MacBook",
			identity: options.identity,
			capabilities: { chat: true, sessionRead: true },
			onHello: (hello) => ({
				kind: "pending",
				approval: options.onManualHello(hello, connection.getSnapshot().verificationCode!, "manual"),
			}),
		});
		const phone = new RemoteConnection(phoneTransport, {
			role: "mobile",
			deviceId: "phone",
			deviceName: "iPhone",
			identity,
			capabilities: { chat: true, sessionRead: true },
		});
		let received: RemoteDevicePaired | undefined;
		phone.onEvent((event) => {
			if (event.type === "remote-event" && event.event.name === "device.paired")
				received = readDevicePaired(event.event.payload);
		});
		options.onAccepted(
			{ type: "manual" },
			{ connection, peerIdentityKey: () => connection.getSnapshot().peerIdentityKey },
		);
		await connection.connect();
		await phone.connect();
		await vi.waitFor(() => expect(h.manager.getState().approvals).toHaveLength(1));
		await h.manager.approvePairing("manual", true);
		await vi.waitFor(() => expect(received).toBeDefined());
		expect(h.readConfig().remoteControl?.devices[0]?.pairingId).toBe("old-pairing");
		expect(options.lookupDevice("old-pairing")).toBeDefined();
		await connectPhone(h, received!.pairingId, identity);
		await vi.waitFor(() => expect(h.readConfig().remoteControl?.devices[0]?.pairingId).toBe(received!.pairingId));
		expect(h.manager.getState().devices[0]).toMatchObject({
			id: "stable-phone",
			name: "My phone",
			desktopControl: false,
		});
		expect(options.lookupDevice("old-pairing")).toBeUndefined();
		await connection.close();
		await phone.close();
		await h.manager.shutdown();
	});

	it("a delayed competing claimant cannot receive or replay the paired phone's events", async () => {
		const h = harness({ cloudEnabled: false, devices: [] });
		const pending = await h.manager.createInvite();
		const intruder = await connectPhone(h, pending.invite!.pairingId, generateIdentityKeyPair(), "Intruder", true);
		const received: string[] = [];
		intruder.phone.onEvent((event) => {
			if (event.type === "remote-event") received.push(event.event.name);
		});
		await connectPhone(h, pending.invite!.pairingId);
		await vi.waitFor(() => expect(h.manager.getState().devices[0]?.online).toBe(true));
		expect(h.manager.getState().devices[0]?.channels).toEqual(["lan"]);
		await intruder.release();
		await vi.waitFor(() => expect(intruder.connection.getSnapshot().state).toBe("closed"));
		expect(received).toEqual([]);
		await h.manager.shutdown();
	});

	it("a permission change concurrent with re-pairing applies to the stable device", async () => {
		const { h, identity } = pairedPhone();
		await h.manager.restore();
		await h.manager.setDesktopControl("stable-phone", true);
		const pending = await h.manager.createInvite();
		const [fresh] = await Promise.all([
			connectPhone(h, pending.invite!.pairingId, identity),
			h.manager.setDesktopControl("stable-phone", false),
		]);
		await vi.waitFor(() =>
			expect(h.readConfig().remoteControl?.devices[0]?.pairingId).toBe(pending.invite!.pairingId),
		);
		expect(h.manager.getState().devices[0]?.desktopControl).toBe(false);
		await expect(fresh.phone.request("screen.subscribe", { active: true })).rejects.toThrow(/does not share/);
		await h.manager.shutdown();
	});

	it("revokes old connections even when credential cleanup fails and retries cleanup after restart", async () => {
		const { h, identity } = pairedPhone();
		await h.manager.restore();
		const old = await connectPhone(h, "old-pairing", identity);
		const pending = await h.manager.createInvite();
		h.failSecretRemoval(true);
		await connectPhone(h, pending.invite!.pairingId, identity);
		await vi.waitFor(() => expect(old.connection.getSnapshot().state).toBe("closed"));
		await vi.waitFor(() => expect(h.manager.getState().devices[0]?.online).toBe(true));
		expect(h.readConfig().remoteControl?.retiredPairingIds).toContain("old-pairing");
		expect(h.lanServers[0]!.options.lookupDevice("old-pairing")).toBeUndefined();
		await h.manager.shutdown();
		const restarted = harness(h.readConfig().remoteControl);
		for (const [key, value] of h.vault) restarted.vault.set(key, value);
		await restarted.manager.restore();
		expect(restarted.store.relaySecret("old-pairing")).toBeUndefined();
		expect(restarted.store.mobileSecret(pending.invite!.pairingId)).toBeUndefined();
		expect(restarted.store.relaySecret(pending.invite!.pairingId)).toBeDefined();
		expect(restarted.readConfig().remoteControl?.retiredPairingIds).not.toContain("old-pairing");
		await restarted.manager.shutdown();
	});

	it("two phones claiming one invitation cannot overwrite the winner", async () => {
		const h = harness({ cloudEnabled: false, devices: [] });
		const pending = await h.manager.createInvite();
		const firstIdentity = generateIdentityKeyPair();
		const [first, second] = await Promise.all([
			connectPhone(h, pending.invite!.pairingId, firstIdentity),
			connectPhone(h, pending.invite!.pairingId, generateIdentityKeyPair()),
		]);
		await vi.waitFor(() => expect(h.manager.getState().devices).toHaveLength(1));
		expect(h.readConfig().remoteControl?.devices[0]?.mobileIdentityKey).toBe(toBase64Url(firstIdentity.publicKey));
		await vi.waitFor(() => expect(second.connection.getSnapshot().state).toBe("closed"));
		expect(first.connection.getSnapshot().state).toBe("online");
		await h.manager.shutdown();
	});
});
