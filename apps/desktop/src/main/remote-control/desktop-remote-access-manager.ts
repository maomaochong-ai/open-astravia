import {
	buildInviteQr,
	buildPairingUri,
	decodePublicKey,
	formatInviteCode,
	generateInviteCode,
	generateInvitePassword,
	inviteBoxId,
	inviteBoxUrl,
	normalizeRelayBaseUrl,
	RemoteConnection,
	type RemoteDevicePaired,
	type RemoteDeviceStatus,
	type RemoteHello,
	type RemoteHelloDecision,
	type RemoteIdentityKeyPair,
	randomToken,
	sealInvite,
	sha256Hex,
	toBase64Url,
} from "@vetta/remote-control";
import type { RemoteControlConfig, RemoteControlDeviceRecord } from "../config/desktop-config-store.js";
import { getAppLogger } from "../logger.js";
import { DESKTOP_REMOTE_CAPABILITIES } from "./desktop-capabilities.js";
import type { DesktopRemoteDesktopHostHandle } from "./desktop-remote-desktop-host.js";
import { DesktopRemoteDeviceHub, type RemoteChannel } from "./desktop-remote-device-hub.js";
import { DesktopRemoteLanServer, type LanAcceptedLink, type LanDeviceCredential } from "./desktop-remote-lan-server.js";
import type { DesktopRemoteMirror } from "./desktop-remote-mirror.js";
import { DesktopRemoteRelayLink } from "./desktop-remote-relay-link.js";
import type { RemoteDeviceStore } from "./remote-device-store.js";
import { toRemoteError } from "./remote-error-mapping.js";
import { createRemoteInviteMailbox, type RemoteInviteMailbox } from "./remote-invite-mailbox.js";
import { listLanEndpoints } from "./remote-lan-endpoints.js";
import { probeRemoteRelay, type RemoteRelayProbeResult } from "./remote-relay-probe.js";

export interface RemoteAccessDeviceView {
	readonly id: string;
	readonly name: string;
	readonly claimed: boolean;
	readonly online: boolean;
	readonly channels: readonly RemoteChannel[];
	/** May view and operate this desktop's screen. */
	readonly desktopControl: boolean;
	readonly createdAt: number;
	readonly lastSeenAt?: number;
}

export interface RemoteAccessInviteView {
	readonly pairingId: string;
	readonly inviteUri: string;
	/**
	 * What the QR code shows (ADR-0138): just the connection code and password once they are
	 * on the relay, the whole pairing URI when there is no code; undefined while the code is
	 * still being left on the relay, so the QR code does not change under a phone's camera.
	 */
	readonly qrText?: string;
	readonly expiresAt: number;
	/** The same invite as a connection code and password, for a phone that is not here (ADR-0136). */
	readonly code?: RemoteAccessInviteCodeView;
}

export interface RemoteAccessInviteCodeView {
	/** "K7Q2-9MXD" */
	readonly code: string;
	readonly password: string;
	/** Being sealed and left on the relay; ready once a phone can fetch it; failed when the relay refused. */
	readonly status: "preparing" | "ready" | "failed";
}

interface InviteCode {
	readonly code: string;
	readonly password: string;
	readonly boxUrl: string;
	readonly token: string;
	readonly status: RemoteAccessInviteCodeView["status"];
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
	/** The relay this build uses when none is set, for "restore default". */
	readonly defaultRelayBaseUrl?: string;
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
	/** Test seam: replaces checking a relay address. */
	readonly probeRelay?: (relayBaseUrl: string) => Promise<RemoteRelayProbeResult>;
	/** Test seam: replaces the relay's invite mailbox. */
	readonly inviteMailbox?: RemoteInviteMailbox;
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
	private readonly desktopHostStops = new Map<string, Promise<void>>();
	private readonly approvals = new Map<string, PendingApproval>();
	private readonly lanLinks = new Map<string, Set<() => void>>();
	private currentInvite:
		| {
				readonly pairingId: string;
				readonly expiresAt: number;
				timer: ReturnType<typeof setTimeout>;
				readonly code?: InviteCode;
		  }
		| undefined;
	private readonly inviteMailbox: RemoteInviteMailbox;
	private currentError: string | undefined;
	private readonly stateListeners = new Set<(state: RemoteAccessState) => void>();
	private stateNotice: ReturnType<typeof setTimeout> | undefined;
	private lastNotified: string | undefined;
	private readonly now: () => number;
	private readonly inviteTtlMs: number;

	constructor(private readonly options: DesktopRemoteAccessManagerOptions) {
		this.now = options.now ?? Date.now;
		this.inviteTtlMs = options.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
		this.inviteMailbox = options.inviteMailbox ?? createRemoteInviteMailbox();
		this.hub = new DesktopRemoteDeviceHub(
			{
				handleRequest: (_deviceId, request) => this.requireMirror().handleRequest(request),
				toRemoteError,
				onLinkOnline: (deviceId, link) =>
					void this.handleLinkOnline(deviceId, link.channel, link.connection).catch((error: unknown) =>
						log.warn("remote link online handling failed", { error: describe(error) }),
					),
				onDeviceOnline: (deviceId, link) =>
					void this.handleDeviceOnline(deviceId, link.channel).catch((error: unknown) =>
						log.warn("remote device online handling failed", { error: describe(error) }),
					),
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
		const previous = this.currentInvite;
		this.currentInvite = value;
		this.stateChanged();
		// Claimed, discarded or expired: nobody should find this invite on the relay any more.
		if (previous?.code && previous.pairingId !== value?.pairingId) {
			const { boxUrl, token } = previous.code;
			void this.inviteMailbox.withdraw(boxUrl, token).catch((error: unknown) => {
				log.warn("remote invite code withdraw failed", { error: describe(error) });
			});
		}
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
				desktopControl: device.desktopControl !== false,
				createdAt: device.createdAt,
				lastSeenAt: device.lastSeenAt,
			})),
			invite: this.invite
				? this.inviteView(this.invite.pairingId, this.invite.expiresAt, this.invite.code)
				: undefined,
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
			defaultRelayBaseUrl: this.options.store.defaultRelayBaseUrl(),
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
		void this.publishInviteCode(pairingId);
		log.info("remote invite created", { pairingId: pairingId.slice(0, 6) });
		return this.getState();
	}

	/**
	 * Seals the invite under a fresh connection code and password and leaves it on the
	 * relay, so a phone elsewhere can pair by typing both in. Needs the relay; the QR
	 * code works either way.
	 */
	private async publishInviteCode(pairingId: string): Promise<void> {
		const relayBaseUrl = this.config.cloudEnabled ? this.config.relayBaseUrl : undefined;
		const invite = this.invite;
		if (!relayBaseUrl || invite?.pairingId !== pairingId) return;
		const view = this.inviteView(pairingId, invite.expiresAt);
		if (!view) return;
		const rawCode = generateInviteCode();
		const code: InviteCode = {
			code: rawCode,
			password: generateInvitePassword(),
			boxUrl: inviteBoxUrl(relayBaseUrl, inviteBoxId(rawCode)),
			token: randomToken(32),
			status: "preparing",
		};
		const settle = (status: InviteCode["status"]): void => {
			const current = this.invite;
			if (current?.pairingId === pairingId) this.invite = { ...current, code: { ...code, status } };
		};
		settle("preparing");
		try {
			const envelope = await sealInvite(view.inviteUri, code.code, code.password);
			await this.inviteMailbox.publish(
				code.boxUrl,
				code.token,
				envelope,
				Math.max(invite.expiresAt - this.now(), 1_000),
			);
			if (this.invite?.pairingId !== pairingId) {
				// Gone while it was being published: take it straight back.
				await this.inviteMailbox.withdraw(code.boxUrl, code.token).catch(() => undefined);
				return;
			}
			settle("ready");
		} catch (error) {
			log.warn("remote invite code publish failed", { error: describe(error) });
			settle("failed");
		}
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
		// A phone that is connected hears it at once and clears what it cached; one that is
		// not finds out when this desktop's local server no longer knows its pairing.
		if (this.hub.isOnline(id)) await this.hub.emit(id, "device.revoked").catch(() => undefined);
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
			await this.options.store.patchDevice(id, { name: trimmed, renamed: true });
			this.config = await this.options.store.read();
		}
		return this.getState();
	}

	/**
	 * Lets one phone view and operate this desktop's screen, or takes that back. The phone
	 * hears it at once, so its remote control shows why the screen is not there.
	 */
	async setDesktopControl(id: string, enabled: boolean): Promise<RemoteAccessState> {
		if (!this.config.devices.some((device) => device.id === id)) return this.getState();
		await this.options.store.patchDevice(id, { desktopControl: enabled });
		this.config = await this.options.store.read();
		this.stateChanged();
		if (enabled) {
			if (this.hub.isOnline(id)) void this.startDesktopHost(id);
		} else {
			await this.desktopHosts
				.get(id)
				?.stop()
				.catch(() => undefined);
			this.desktopHosts.delete(id);
		}
		if (this.hub.isOnline(id)) await this.hub.emit(id, "device.status", this.deviceStatus(id)).catch(() => undefined);
		log.info("remote desktop control changed", { pairingId: id.slice(0, 6), enabled });
		return this.getState();
	}

	/**
	 * Moves access away from this network to another relay, or back to the default one
	 * (`undefined`). Connected phones hear the new address first, so they follow instead
	 * of losing the relay; the current QR code, made for the old relay, is replaced.
	 */
	async setRelayBaseUrl(value: string | undefined): Promise<RemoteAccessState> {
		const typed = value?.trim();
		const normalized = typed ? normalizeRelayBaseUrl(typed) : undefined;
		if (typed && !normalized) throw new Error("invalid relay address");
		const fallback = this.options.store.defaultRelayBaseUrl();
		const stored = normalized === fallback ? undefined : normalized;
		const next = stored ?? fallback;
		if (next === this.config.relayBaseUrl) return this.getState();
		for (const device of this.config.devices) {
			if (!this.hub.isOnline(device.id)) continue;
			await this.hub
				.emit(device.id, "device.status", { ...this.deviceStatus(device.id), relayBaseUrl: next })
				.catch(() => undefined);
		}
		this.config = await this.options.store.update((current) => ({ ...current, relayBaseUrl: stored }));
		for (const link of this.relayLinks.values()) await link.stop();
		this.relayLinks.clear();
		for (const host of this.desktopHosts.values()) await host.stop().catch(() => undefined);
		this.desktopHosts.clear();
		await this.cancelInvite();
		await this.reconcile();
		for (const device of this.config.devices) {
			if (this.hub.isOnline(device.id)) void this.startDesktopHost(device.id);
		}
		log.info("remote relay changed", { custom: stored !== undefined });
		return this.getState();
	}

	/** Whether a relay address answers, and whether it can hold connection codes. */
	testRelay(value: string): Promise<RemoteRelayProbeResult> {
		const normalized = normalizeRelayBaseUrl(value.trim());
		if (!normalized) return Promise.resolve("unreachable");
		return (this.options.probeRelay ?? probeRemoteRelay)(normalized);
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
			name: snapshot.peerDeviceName?.trim() || "手机",
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
		const snapshot = connection.getSnapshot();
		const peerKey = snapshot.peerIdentityKey;
		if (!device.mobileIdentityKey && peerKey) await this.claim(deviceId, peerKey, snapshot.peerDeviceName);
		// A phone renamed since pairing (or paired before its name was kept) shows its current name,
		// unless the name was chosen on this desktop.
		const name = device.renamed ? undefined : snapshot.peerDeviceName?.trim();
		// Only a "last seen" time and the name: failing to save them must not keep the phone from being served.
		try {
			await this.options.store.patchDevice(deviceId, {
				lastSeenAt: this.now(),
				...(name && name !== device.name ? { name } : {}),
			});
			this.config = await this.options.store.read();
		} catch (error) {
			log.warn("remote device last-seen save failed", { pairingId: deviceId.slice(0, 6), error: describe(error) });
		}
		await this.hub.emit(deviceId, "device.status", this.deviceStatus(deviceId)).catch(() => undefined);
		log.info("remote link online", { pairingId: deviceId.slice(0, 6), channel });
		// The screen may have gone while this link was reconnecting; the phone never counted as
		// offline (the grace period covers a brief absence), so nothing else would bring it back.
		if (channel !== "p2p") void this.startDesktopHost(deviceId);
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
		// The screen is shared only with a phone the person allowed it for.
		if (this.config.devices.find((entry) => entry.id === deviceId)?.desktopControl === false) return;
		if (this.desktopHosts.has(deviceId) || this.desktopHostStarts.has(deviceId)) return;
		this.desktopHostStarts.add(deviceId);
		try {
			// A host still stopping would be handed back instead of a new one.
			await this.desktopHostStops.get(deviceId)?.catch(() => undefined);
			const host = await controller.start({ relayBaseUrl, pairingId: deviceId, desktopSecret });
			if (!this.hub.isOnline(deviceId)) {
				await host.stop();
				return;
			}
			const device = this.config.devices.find((entry) => entry.id === deviceId);
			// Turned off, or never claimed, while the host was starting.
			if (!device?.mobileIdentityKey || device.desktopControl === false) {
				await host.stop();
				return;
			}
			const connection = new RemoteConnection(host.controlTransport, {
				role: "desktop",
				handshake: "accept",
				deviceId: this.options.deviceId,
				deviceName: this.options.deviceName,
				capabilities: DESKTOP_REMOTE_CAPABILITIES,
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
				const stopped = host.stop();
				this.desktopHostStops.set(deviceId, stopped);
				void stopped.finally(() => {
					if (this.desktopHostStops.get(deviceId) === stopped) this.desktopHostStops.delete(deviceId);
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

	/** With `deviceId`, also says whether that phone may use the desktop's screen. */
	private deviceStatus(deviceId?: string): RemoteDeviceStatus {
		const port = this.lanServer?.listeningPort;
		const device = deviceId ? this.config.devices.find((entry) => entry.id === deviceId) : undefined;
		return {
			deviceName: this.options.deviceName,
			osLabel: this.options.osLabel,
			lanEndpoints: port ? this.lanEndpoints(port) : [],
			relayEnabled: this.config.cloudEnabled && Boolean(this.config.relayBaseUrl),
			runningSessionCount: this.options.runningSessionCount(),
			fileRead: DESKTOP_REMOTE_CAPABILITIES.fileRead === true,
			...(device ? { desktopControl: device.desktopControl !== false } : {}),
			...(this.config.cloudEnabled && this.config.relayBaseUrl ? { relayBaseUrl: this.config.relayBaseUrl } : {}),
		};
	}

	private lanEndpoints(port: number): string[] {
		return (this.options.listLanEndpoints ?? listLanEndpoints)(port);
	}

	private inviteView(pairingId: string, expiresAt: number, code?: InviteCode): RemoteAccessInviteView | undefined {
		const mobileSecret = this.options.store.mobileSecret(pairingId);
		if (!mobileSecret) return undefined;
		const port = this.lanServer?.listeningPort;
		const relayBaseUrl = this.config.cloudEnabled ? this.config.relayBaseUrl : undefined;
		const inviteUri = buildPairingUri({
			version: 2,
			pairingId,
			mobileSecret,
			desktopIdentityKey: toBase64Url(this.identity().publicKey),
			desktopName: this.options.deviceName,
			lanEndpoints: port ? this.lanEndpoints(port) : [],
			relayBaseUrl,
		});
		// With a relay a code is always on its way (publishInviteCode), even before it is recorded.
		const qrText =
			code?.status === "ready"
				? buildInviteQr({
						code: code.code,
						password: code.password,
						// The phones know the default relay; name it only when this desktop uses another.
						relayBaseUrl: relayBaseUrl === this.options.store.defaultRelayBaseUrl() ? undefined : relayBaseUrl,
					})
				: code?.status === "failed" || !relayBaseUrl
					? inviteUri
					: undefined;
		return {
			pairingId,
			expiresAt,
			inviteUri,
			...(qrText ? { qrText } : {}),
			...(code ? { code: { code: formatInviteCode(code.code), password: code.password, status: code.status } } : {}),
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
