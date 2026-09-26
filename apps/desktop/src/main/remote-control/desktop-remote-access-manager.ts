import {
	buildPairingUri,
	decodePublicKey,
	RemoteConnection,
	type RemoteDevicePaired,
	type RemoteDeviceStatus,
	type RemoteHello,
	type RemoteHelloDecision,
	type RemoteIdentityKeyPair,
	randomToken,
	sha256Hex,
	toBase64Url,
} from "@vetta/remote-control";
import type { RemoteControlConfig, RemoteControlDeviceRecord } from "../config/desktop-config-store.js";
import { getAppLogger } from "../logger.js";
import type { DesktopRemoteDesktopHostHandle } from "./desktop-remote-desktop-host.js";
import { DesktopRemoteDeviceHub, type RemoteChannel } from "./desktop-remote-device-hub.js";
import { DesktopRemoteLanServer, type LanAcceptedLink, type LanDeviceCredential } from "./desktop-remote-lan-server.js";
import type { DesktopRemoteMirror } from "./desktop-remote-mirror.js";
import { DesktopRemoteRelayLink } from "./desktop-remote-relay-link.js";
import type { RemoteDeviceStore } from "./remote-device-store.js";
import { toRemoteError } from "./remote-error-mapping.js";
import { listLanEndpoints } from "./remote-lan-endpoints.js";

export interface RemoteAccessDeviceView {
	readonly id: string;
	readonly name: string;
	readonly claimed: boolean;
	readonly online: boolean;
	readonly channels: readonly RemoteChannel[];
	readonly createdAt: number;
	readonly lastSeenAt?: number;
}

export interface RemoteAccessInviteView {
	readonly pairingId: string;
	readonly inviteUri: string;
	readonly expiresAt: number;
}

export interface RemoteAccessApprovalView {
	readonly id: string;
	readonly deviceName: string;
	readonly code: string;
	readonly requestedAt: number;
}

export interface RemoteAccessState {
	readonly devices: readonly RemoteAccessDeviceView[];
	readonly invite?: RemoteAccessInviteView;
	readonly approvals: readonly RemoteAccessApprovalView[];
	readonly lanPort?: number;
	readonly lanEndpoints: readonly string[];
	readonly cloudEnabled: boolean;
	readonly relayBaseUrl?: string;
	readonly vaultAvailable: boolean;
	readonly error?: string;
}

export interface RemoteAccessNotifications {
	deviceConnected(device: { readonly id: string; readonly name: string; readonly channel: RemoteChannel }): void;
	pairingRequested(request: { readonly deviceName: string; readonly code: string }): void;
}

export interface DesktopRemoteDesktopController {
	start(options: {
		readonly relayBaseUrl: string;
		readonly pairingId: string;
		readonly desktopSecret: string;
	}): Promise<DesktopRemoteDesktopHostHandle>;
}

export interface DesktopRemoteAccessManagerOptions {
	readonly store: RemoteDeviceStore;
	readonly createMirror: (
		emit: DesktopRemoteDeviceHub["broadcast"],
		deviceStatus: () => RemoteDeviceStatus,
	) => DesktopRemoteMirror;
	readonly notifications: RemoteAccessNotifications;
	readonly remoteDesktop?: DesktopRemoteDesktopController;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly osLabel?: string;
	readonly runningSessionCount: () => number;
	readonly listLanEndpoints?: (port: number) => string[];
	readonly inviteTtlMs?: number;
	readonly now?: () => number;
	/** Test seam: replaces the LAN server. */
	readonly createLanServer?: (
		options: ConstructorParameters<typeof DesktopRemoteLanServer>[0],
	) => Pick<DesktopRemoteLanServer, "start" | "stop" | "listeningPort">;
	/** Test seam: replaces relay links. */
	readonly createRelayLink?: (
		options: ConstructorParameters<typeof DesktopRemoteRelayLink>[0],
	) => Pick<DesktopRemoteRelayLink, "start" | "stop">;
	readonly hubGraceMs?: number;
}

interface PendingApproval {
	readonly id: string;
	readonly hello: RemoteHello;
	readonly code: string;
	readonly requestedAt: number;
	readonly resolve: (approved: boolean) => void;
}

const log = getAppLogger("remote-access");
const DEFAULT_INVITE_TTL_MS = 10 * 60_000;
const MANUAL_LINK_LINGER_MS = 3_000;

/**
 * Owns everything about paired phones on the desktop side and enforces the
 * "no phone, no cost" rule: with no paired device and no outstanding invite
 * it holds no port, no relay socket and no runtime subscription. The LAN
 * server and relay links come up only for devices that exist; the session
 * mirror comes up only while a phone is actually online.
 */
export class DesktopRemoteAccessManager {
	private readonly hub: DesktopRemoteDeviceHub;
	private mirror: DesktopRemoteMirror | undefined;
	private currentConfig: RemoteControlConfig = { cloudEnabled: true, devices: [] };
	private identityCache: RemoteIdentityKeyPair | undefined;
	private lanServer: Pick<DesktopRemoteLanServer, "start" | "stop" | "listeningPort"> | undefined;
	private readonly relayLinks = new Map<string, Pick<DesktopRemoteRelayLink, "start" | "stop">>();
	private readonly desktopHosts = new Map<string, DesktopRemoteDesktopHostHandle>();
	private readonly desktopHostStarts = new Set<string>();
	private readonly approvals = new Map<string, PendingApproval>();
	private readonly lanLinks = new Map<string, Set<() => void>>();
	private currentInvite:
		| { readonly pairingId: string; readonly expiresAt: number; timer: ReturnType<typeof setTimeout> }
		| undefined;
	private currentError: string | undefined;
	private readonly stateListeners = new Set<(state: RemoteAccessState) => void>();
	private stateNotice: ReturnType<typeof setTimeout> | undefined;
	private lastNotified: string | undefined;
	private readonly now: () => number;
	private readonly inviteTtlMs: number;

	constructor(private readonly options: DesktopRemoteAccessManagerOptions) {
		this.now = options.now ?? Date.now;
		this.inviteTtlMs = options.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
		this.hub = new DesktopRemoteDeviceHub(
			{
				handleRequest: (_deviceId, request) => this.requireMirror().handleRequest(request),
				toRemoteError,
				onLinkOnline: (deviceId, link) => void this.handleLinkOnline(deviceId, link.channel, link.connection),
				onDeviceOnline: (deviceId, link) => void this.handleDeviceOnline(deviceId, link.channel),
				onDeviceOffline: () => this.handleDeviceOffline(),
				onLinksChanged: () => this.stateChanged(),
			},
			{ offlineGraceMs: options.hubGraceMs },
		);
	}

	// ---- public state ----

	/**
	 * Tells the settings page about every change as it happens (a phone coming or going,
	 * a channel switching, an invite or approval appearing) instead of it asking every
	 * second. Changes are gathered for a tick and only a different state is sent.
	 */
	onStateChanged(listener: (state: RemoteAccessState) => void): () => void {
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
	}

	private stateChanged(): void {
		if (this.stateNotice || this.stateListeners.size === 0) return;
		this.stateNotice = setTimeout(() => {
			this.stateNotice = undefined;
			const state = this.getState();
			const serialized = JSON.stringify(state);
			if (serialized === this.lastNotified) return;
			this.lastNotified = serialized;
			for (const listener of this.stateListeners) listener(state);
		}, 0);
		this.stateNotice.unref?.();
	}

	// Every change to what the settings page shows passes through these.
	private get config(): RemoteControlConfig {
		return this.currentConfig;
	}

	private set config(value: RemoteControlConfig) {
		this.currentConfig = value;
		this.stateChanged();
	}

	private get invite() {
		return this.currentInvite;
	}

	private set invite(value) {
		this.currentInvite = value;
		this.stateChanged();
	}

	private get lastError(): string | undefined {
		return this.currentError;
	}

	private set lastError(value: string | undefined) {
		this.currentError = value;
		this.stateChanged();
	}

	getState(): RemoteAccessState {
		const port = this.lanServer?.listeningPort;
		return {
			devices: this.config.devices.map((device) => ({
				id: device.id,
				name: device.name,
				claimed: device.mobileIdentityKey !== undefined,
				online: this.hub.isOnline(device.id),
				channels: this.hub.onlineChannels(device.id),
				createdAt: device.createdAt,
				lastSeenAt: device.lastSeenAt,
			})),
			invite: this.invite ? this.inviteView(this.invite.pairingId, this.invite.expiresAt) : undefined,
			approvals: [...this.approvals.values()].map((approval) => ({
				id: approval.id,
				deviceName: approval.hello.deviceName,
				code: approval.code,
				requestedAt: approval.requestedAt,
			})),
			lanPort: port,
			lanEndpoints: port ? this.lanEndpoints(port) : [],
			cloudEnabled: this.config.cloudEnabled,
			relayBaseUrl: this.config.relayBaseUrl,
			vaultAvailable: this.options.store.vaultAvailable(),
			error: this.lastError,
		};
	}

	/** Loads persisted devices and brings up transports only if any exist. */
	async restore(): Promise<void> {
		this.config = await this.options.store.read();
		if (this.config.devices.length === 0) return;
		await this.reconcile();
	}

	async shutdown(): Promise<void> {
		if (this.invite) clearTimeout(this.invite.timer);
		this.invite = undefined;
		for (const approval of this.approvals.values()) approval.resolve(false);
		this.approvals.clear();
		await this.hub.dropAll();
		this.mirror?.stop();
		this.mirror = undefined;
		for (const link of this.relayLinks.values()) await link.stop();
		this.relayLinks.clear();
		for (const host of this.desktopHosts.values()) await host.stop().catch(() => undefined);
		this.desktopHosts.clear();
		this.desktopHostStarts.clear();
		await this.lanServer?.stop();
		this.lanServer = undefined;
	}

	// ---- invites & devices ----

	async createInvite(): Promise<RemoteAccessState> {
		if (!this.options.store.vaultAvailable()) throw new Error("当前系统无法使用安全凭据存储");
		await this.cancelInvite();
		const pairingId = randomToken(24);
		const mobileSecret = randomToken(32);
		const relaySecret = randomToken(32);
		const record: RemoteControlDeviceRecord = {
			id: pairingId,
			name: "",
			mobileSecretHash: sha256Hex(mobileSecret),
			createdAt: this.now(),
		};
		this.options.store.putMobileSecret(pairingId, mobileSecret);
		this.options.store.putRelaySecret(pairingId, relaySecret);
		await this.options.store.upsertDevice(record);
		this.config = await this.options.store.read();
		const expiresAt = this.now() + this.inviteTtlMs;
		const timer = setTimeout(() => void this.expireInvite(pairingId), this.inviteTtlMs);
		timer.unref?.();
		this.invite = { pairingId, expiresAt, timer };
		await this.reconcile();
		log.info("remote invite created", { pairingId: pairingId.slice(0, 6) });
		return this.getState();
	}

	async cancelInvite(): Promise<RemoteAccessState> {
		const invite = this.invite;
		if (!invite) return this.getState();
		clearTimeout(invite.timer);
		this.invite = undefined;
		const device = this.config.devices.find((entry) => entry.id === invite.pairingId);
		if (device && device.mobileIdentityKey === undefined) await this.revokeDevice(invite.pairingId);
		return this.getState();
	}

	async revokeDevice(id: string): Promise<RemoteAccessState> {
		if (this.invite?.pairingId === id) {
			clearTimeout(this.invite.timer);
			this.invite = undefined;
		}
		await this.hub.drop(id);
		await this.desktopHosts
			.get(id)
			?.stop()
			.catch(() => undefined);
		this.desktopHosts.delete(id);
		this.desktopHostStarts.delete(id);
		await this.relayLinks.get(id)?.stop();
		this.relayLinks.delete(id);
		await this.options.store.removeDevice(id);
		this.config = await this.options.store.read();
		await this.reconcile();
		log.info("remote device revoked", { pairingId: id.slice(0, 6) });
		return this.getState();
	}

	async renameDevice(id: string, name: string): Promise<RemoteAccessState> {
		const trimmed = name.trim().slice(0, 64);
		if (trimmed) {
			await this.options.store.patchDevice(id, { name: trimmed });
			this.config = await this.options.store.read();
		}
		return this.getState();
	}

	async setCloudEnabled(enabled: boolean): Promise<RemoteAccessState> {
		this.config = await this.options.store.update((current) => ({ ...current, cloudEnabled: enabled }));
		this.config = await this.options.store.read();
		await this.reconcile();
		return this.getState();
	}

	async approvePairing(id: string, allow: boolean): Promise<RemoteAccessState> {
		const approval = this.approvals.get(id);
		if (approval) {
			this.approvals.delete(id);
			approval.resolve(allow);
			this.stateChanged();
		}
		return this.getState();
	}

	// ---- transports ----

	private async reconcile(): Promise<void> {
		const needed = this.config.devices.length > 0;
		if (!needed) {
			for (const link of this.relayLinks.values()) await link.stop();
			this.relayLinks.clear();
			await this.lanServer?.stop();
			this.lanServer = undefined;
			return;
		}
		if (!this.lanServer) {
			const server = (this.options.createLanServer ?? ((opts) => new DesktopRemoteLanServer(opts)))({
				identity: this.identity(),
				deviceId: this.options.deviceId,
				deviceName: this.options.deviceName,
				lookupDevice: (pairingId) => this.credentialFor(pairingId),
				onDeviceHello: (device, hello) => this.decideDeviceHello(device, hello),
				onManualHello: (hello, code, connectionId) => this.requestApproval(hello, code, connectionId),
				onAccepted: (kind, link) => this.handleLanAccepted(kind, link),
				journalFor: (deviceId) => this.hub.journalFor(deviceId),
			});
			this.lanServer = server;
			try {
				const port = await server.start(this.config.lanPort);
				if (port !== this.config.lanPort) {
					this.config = await this.options.store.update((current) => ({ ...current, lanPort: port }));
				}
				this.lastError = undefined;
			} catch (error) {
				this.lanServer = undefined;
				this.lastError = `局域网端口无法监听：${describe(error)}`;
				log.warn("remote LAN server failed to start", { error: describe(error) });
			}
		}
		const wantRelay = this.config.cloudEnabled && Boolean(this.config.relayBaseUrl);
		const activeIds = new Set(this.config.devices.map((device) => device.id));
		for (const [id, link] of [...this.relayLinks]) {
			if (!wantRelay || !activeIds.has(id)) {
				await link.stop();
				this.relayLinks.delete(id);
			}
		}
		if (!wantRelay || !this.config.relayBaseUrl) return;
		for (const device of this.config.devices) {
			if (this.relayLinks.has(device.id)) continue;
			const desktopSecret = this.options.store.relaySecret(device.id);
			if (!desktopSecret) continue;
			const link = (this.options.createRelayLink ?? ((opts) => new DesktopRemoteRelayLink(opts)))({
				relayBaseUrl: this.config.relayBaseUrl,
				pairingId: device.id,
				desktopSecret,
				mobileSecretHash: device.mobileSecretHash,
				identity: this.identity(),
				deviceId: this.options.deviceId,
				deviceName: this.options.deviceName,
				mobileIdentityKey: device.mobileIdentityKey,
				journal: this.hub.journalFor(device.id),
				onConnection: (connection) => {
					this.hub.attach(device.id, { channel: "relay", connection });
				},
			});
			this.relayLinks.set(device.id, link);
			link.start();
		}
	}

	private credentialFor(pairingId: string): LanDeviceCredential | undefined {
		const device = this.config.devices.find((entry) => entry.id === pairingId);
		if (!device) return undefined;
		return { id: device.id, mobileSecretHash: device.mobileSecretHash, mobileIdentityKey: device.mobileIdentityKey };
	}

	private decideDeviceHello(device: LanDeviceCredential, hello: RemoteHello): RemoteHelloDecision {
		if (device.mobileIdentityKey) {
			// The connection already compared the pinned key; a mismatch never reaches here.
			return { kind: "approve" };
		}
		void this.claim(device.id, hello.identityKey, hello.deviceName);
		return { kind: "approve" };
	}

	/** First phone to present an invite's secret becomes its owner; the invite cannot be reused afterwards. */
	private async claim(deviceId: string, identityKey: string, deviceName: string | undefined): Promise<void> {
		const current = this.config.devices.find((device) => device.id === deviceId);
		if (!current || current.mobileIdentityKey) return;
		const name = deviceName?.trim() || current.name || "手机";
		await this.options.store.patchDevice(deviceId, { mobileIdentityKey: identityKey, name, lastSeenAt: this.now() });
		this.options.store.clearMobileSecret(deviceId);
		this.config = await this.options.store.read();
		if (this.invite?.pairingId === deviceId) {
			clearTimeout(this.invite.timer);
			this.invite = undefined;
		}
		// The relay link for this device pinned nothing so far; restart it so
		// it rejects any other identity from now on.
		const link = this.relayLinks.get(deviceId);
		if (link) {
			await link.stop();
			this.relayLinks.delete(deviceId);
			await this.reconcile();
		}
		log.info("remote device claimed", { pairingId: deviceId.slice(0, 6) });
		await this.forgetEarlierPairings(deviceId, identityKey);
	}

	/**
	 * A phone that pairs again (scanning a new code, or pairing by address) replaces the
	 * pairing it had: without this each scan left another record that never came online
	 * again but kept its credentials. Phones are told apart by their pinned identity key.
	 */
	private async forgetEarlierPairings(keepId: string, identityKey: string): Promise<void> {
		const earlier = this.config.devices.filter(
			(device) => device.id !== keepId && device.mobileIdentityKey === identityKey,
		);
		for (const device of earlier) await this.revokeDevice(device.id);
		if (earlier.length > 0)
			log.info("remote device replaced earlier pairings", {
				pairingId: keepId.slice(0, 6),
				replaced: earlier.length,
			});
	}

	private requestApproval(hello: RemoteHello, code: string, connectionId: string): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			const approval: PendingApproval = { id: connectionId, hello, code, requestedAt: this.now(), resolve };
			this.approvals.set(connectionId, approval);
			this.stateChanged();
			this.options.notifications.pairingRequested({ deviceName: hello.deviceName, code });
			const timer = setTimeout(() => {
				if (this.approvals.get(connectionId) === approval) {
					this.approvals.delete(connectionId);
					this.stateChanged();
					resolve(false);
				}
			}, 5 * 60_000);
			timer.unref?.();
		});
	}

	private handleLanAccepted(
		kind: { readonly type: "device"; readonly id: string } | { readonly type: "manual" },
		link: LanAcceptedLink,
	): void {
		if (kind.type === "device") {
			const detach = this.hub.attach(kind.id, { channel: "lan", connection: link.connection });
			const set = this.lanLinks.get(kind.id) ?? new Set();
			set.add(detach);
			this.lanLinks.set(kind.id, set);
			return;
		}
		// Manual pairing: once the person approved and the handshake finished,
		// mint the device and hand the phone its long-lived credential over the
		// encrypted link. The phone then reconnects on the normal path.
		const unsubscribe = link.connection.onEvent((event) => {
			if (event.type !== "state") return;
			if (event.state === "online") {
				unsubscribe();
				void this.finishManualPairing(link.connection, link.peerIdentityKey());
			} else if (event.state === "failed" || event.state === "closed") {
				unsubscribe();
			}
		});
	}

	private async finishManualPairing(connection: RemoteConnection, peerIdentityKey: string | undefined): Promise<void> {
		if (!peerIdentityKey) {
			await connection.close();
			return;
		}
		const snapshot = connection.getSnapshot();
		const pairingId = randomToken(24);
		const mobileSecret = randomToken(32);
		const relaySecret = randomToken(32);
		this.options.store.putRelaySecret(pairingId, relaySecret);
		await this.options.store.upsertDevice({
			id: pairingId,
			name: snapshot.peerDeviceId ?? "手机",
			mobileSecretHash: sha256Hex(mobileSecret),
			mobileIdentityKey: peerIdentityKey,
			createdAt: this.now(),
			lastSeenAt: this.now(),
		});
		this.config = await this.options.store.read();
		await this.forgetEarlierPairings(pairingId, peerIdentityKey);
		await this.reconcile();
		const port = this.lanServer?.listeningPort;
		const paired: RemoteDevicePaired = {
			pairingId,
			mobileSecret,
			desktopName: this.options.deviceName,
			lanEndpoints: port ? this.lanEndpoints(port) : [],
			relayBaseUrl: this.config.cloudEnabled ? this.config.relayBaseUrl : undefined,
		};
		try {
			await connection.emitEvent("device.paired", paired);
		} catch (error) {
			log.warn("remote manual pairing handoff failed", { error: describe(error) });
		}
		const timer = setTimeout(() => void connection.close().catch(() => undefined), MANUAL_LINK_LINGER_MS);
		timer.unref?.();
		log.info("remote device paired manually", { pairingId: pairingId.slice(0, 6) });
	}

	// ---- hub callbacks ----

	private async handleLinkOnline(
		deviceId: string,
		channel: RemoteChannel,
		connection: RemoteConnection,
	): Promise<void> {
		const device = this.config.devices.find((entry) => entry.id === deviceId);
		if (!device) return;
		const peerKey = connection.getSnapshot().peerIdentityKey;
		if (!device.mobileIdentityKey && peerKey) await this.claim(deviceId, peerKey, undefined);
		await this.options.store.patchDevice(deviceId, { lastSeenAt: this.now() });
		this.config = await this.options.store.read();
		await this.hub.emit(deviceId, "device.status", this.deviceStatus()).catch(() => undefined);
		log.info("remote link online", { pairingId: deviceId.slice(0, 6), channel });
	}

	private async handleDeviceOnline(deviceId: string, channel: RemoteChannel): Promise<void> {
		const device = this.config.devices.find((entry) => entry.id === deviceId);
		this.options.notifications.deviceConnected({ id: deviceId, name: device?.name || "手机", channel });
		if (!this.mirror) {
			this.mirror = this.options.createMirror(
				(name, payload, sessionId) => this.hub.broadcast(name, payload, sessionId),
				() => this.deviceStatus(),
			);
			try {
				await this.mirror.start();
			} catch (error) {
				log.warn("remote mirror failed to start", { error: describe(error) });
			}
		}
		void this.startDesktopHost(deviceId);
	}

	private handleDeviceOffline(): void {
		if (this.hub.hasOnlineDevices()) return;
		this.mirror?.stop();
		this.mirror = undefined;
		for (const [deviceId, host] of this.desktopHosts) {
			void host.stop().finally(() => this.desktopHosts.delete(deviceId));
		}
		log.info("remote mirror stopped: no phone online");
	}

	private async startDesktopHost(deviceId: string): Promise<void> {
		const controller = this.options.remoteDesktop;
		const relayBaseUrl = this.config.relayBaseUrl;
		const desktopSecret = this.options.store.relaySecret(deviceId);
		if (!controller || !this.config.cloudEnabled || !relayBaseUrl || !desktopSecret) return;
		if (this.desktopHosts.has(deviceId) || this.desktopHostStarts.has(deviceId)) return;
		this.desktopHostStarts.add(deviceId);
		try {
			const host = await controller.start({ relayBaseUrl, pairingId: deviceId, desktopSecret });
			if (!this.hub.isOnline(deviceId)) {
				await host.stop();
				return;
			}
			const device = this.config.devices.find((entry) => entry.id === deviceId);
			if (!device?.mobileIdentityKey) {
				await host.stop();
				return;
			}
			const connection = new RemoteConnection(host.controlTransport, {
				role: "desktop",
				handshake: "accept",
				deviceId: this.options.deviceId,
				deviceName: this.options.deviceName,
				capabilities: { chat: true, sessionRead: true },
				identity: this.identity(),
				expectedPeerIdentityKey: decodePublicKey(device.mobileIdentityKey),
				journal: this.hub.journalFor(deviceId),
				onHello: () => ({ kind: "approve" }),
				logger: {
					debug: (message, fields) => log.debug(message, fields),
					info: (message, fields) => log.info(message, fields),
					warn: (message, fields) => log.warn(message, fields),
				},
			});
			this.desktopHosts.set(deviceId, host);
			const detach = this.hub.attach(deviceId, { channel: "p2p", connection });
			let released = false;
			const release = (): void => {
				if (released) return;
				released = true;
				unsubscribe();
				detach();
				if (this.desktopHosts.get(deviceId) === host) this.desktopHosts.delete(deviceId);
				void host.stop().finally(() => {
					if (this.hub.onlineChannels(deviceId).some((activeChannel) => activeChannel !== "p2p")) {
						void this.startDesktopHost(deviceId);
					}
				});
			};
			const unsubscribe = connection.onEvent((event) => {
				if (
					event.type === "state" &&
					(event.state === "closed" || event.state === "failed" || event.state === "reconnecting")
				) {
					release();
				}
			});
			try {
				await connection.connect();
			} catch (error) {
				release();
				throw error;
			}
		} catch (error) {
			log.warn("remote desktop host failed to start", { deviceId: deviceId.slice(0, 6), error: describe(error) });
		} finally {
			this.desktopHostStarts.delete(deviceId);
		}
	}

	private requireMirror(): DesktopRemoteMirror {
		if (!this.mirror) {
			this.mirror = this.options.createMirror(
				(name, payload, sessionId) => this.hub.broadcast(name, payload, sessionId),
				() => this.deviceStatus(),
			);
			void this.mirror.start();
		}
		return this.mirror;
	}

	// ---- helpers ----

	private identity(): RemoteIdentityKeyPair {
		this.identityCache ??= this.options.store.identity();
		return this.identityCache;
	}

	private deviceStatus(): RemoteDeviceStatus {
		const port = this.lanServer?.listeningPort;
		return {
			deviceName: this.options.deviceName,
			osLabel: this.options.osLabel,
			lanEndpoints: port ? this.lanEndpoints(port) : [],
			relayEnabled: this.config.cloudEnabled && Boolean(this.config.relayBaseUrl),
			runningSessionCount: this.options.runningSessionCount(),
		};
	}

	private lanEndpoints(port: number): string[] {
		return (this.options.listLanEndpoints ?? listLanEndpoints)(port);
	}

	private inviteView(pairingId: string, expiresAt: number): RemoteAccessInviteView | undefined {
		const mobileSecret = this.options.store.mobileSecret(pairingId);
		if (!mobileSecret) return undefined;
		const port = this.lanServer?.listeningPort;
		return {
			pairingId,
			expiresAt,
			inviteUri: buildPairingUri({
				version: 2,
				pairingId,
				mobileSecret,
				desktopIdentityKey: toBase64Url(this.identity().publicKey),
				desktopName: this.options.deviceName,
				lanEndpoints: port ? this.lanEndpoints(port) : [],
				relayBaseUrl: this.config.cloudEnabled ? this.config.relayBaseUrl : undefined,
			}),
		};
	}

	private async expireInvite(pairingId: string): Promise<void> {
		if (this.invite?.pairingId !== pairingId) return;
		this.invite = undefined;
		const device = this.config.devices.find((entry) => entry.id === pairingId);
		if (device && device.mobileIdentityKey === undefined) {
			await this.revokeDevice(pairingId);
			log.info("remote invite expired", { pairingId: pairingId.slice(0, 6) });
		}
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
