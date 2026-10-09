import type { RemoteRequest, RemoteScreenCursor } from "@vetta/remote-control";
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
	RemoteEventJournal,
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
import type { RemoteChannel, RemoteDeviceLink } from "./desktop-remote-device-hub.js";
import { DesktopRemoteDeviceHub } from "./desktop-remote-device-hub.js";
import { DesktopRemoteLanServer, type LanAcceptedLink, type LanDeviceCredential } from "./desktop-remote-lan-server.js";
import type { DesktopRemoteMirror } from "./desktop-remote-mirror.js";
import { DesktopRemoteRelayLink } from "./desktop-remote-relay-link.js";
import { pairingIdOf } from "./remote-device-pairings.js";
import type { RemoteDeviceStore } from "./remote-device-store.js";
import { RemoteOperationError, toRemoteError } from "./remote-error-mapping.js";
import { createRemoteInviteMailbox, type RemoteInviteMailbox } from "./remote-invite-mailbox.js";
import { listLanEndpoints } from "./remote-lan-endpoints.js";
import { probeRemoteRelay, type RemoteRelayProbeResult } from "./remote-relay-probe.js";
import { RemoteScreenShare, type ScreenSharePermissions } from "./remote-screen-share.js";

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
	/** A phone opened the screen but macOS withholds Screen Recording or Accessibility (ADR-0140). */
	screenPermissionMissing?(request: {
		readonly deviceName: string;
		readonly screen: boolean;
		readonly input: boolean;
	}): void;
}

export interface DesktopRemoteDesktopController {
	start(options: {
		readonly relayBaseUrl: string;
		readonly pairingId: string;
		readonly desktopSecret: string;
		/** The phone declared `screen`: capture only while it subscribes (ADR-0140). */
		readonly screenOnDemand: boolean;
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
	/** macOS privacy permissions the screen needs; granted everywhere when left out. */
	readonly screenPermissions?: ScreenSharePermissions;
	/** Test seam: how often a missing permission is checked again. */
	readonly screenPermissionPollMs?: number;
	/** The pointer the desktop shows now, for phones that draw it; left out where it cannot be read. */
	readonly readCursor?: () => RemoteScreenCursor | undefined;
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
	/** Runtime resources follow pairing IDs; public device IDs survive credential rotation. */
	private readonly hub: DesktopRemoteDeviceHub;
	private mirror: DesktopRemoteMirror | undefined;
	private currentConfig: RemoteControlConfig = { cloudEnabled: true, devices: [] };
	private identityCache: RemoteIdentityKeyPair | undefined;
	private lanServer: Pick<DesktopRemoteLanServer, "start" | "stop" | "listeningPort"> | undefined;
	private readonly relayLinks = new Map<string, Pick<DesktopRemoteRelayLink, "start" | "stop">>();
	private readonly desktopHosts = new Map<string, DesktopRemoteDesktopHostHandle>();
	private readonly desktopHostStarts = new Set<string>();
	private readonly desktopHostStops = new Map<string, Promise<void>>();
	/** Phones that declared `screen` in their hello and so subscribe to it on demand. */
	private readonly screenOnDemand = new Map<string, boolean>();
	/** Whether each running host captures on demand, to replace one that does not. */
	private readonly hostOnDemand = new Map<string, boolean>();
	private readonly screenShare: RemoteScreenShare;
	private readonly approvals = new Map<string, PendingApproval>();
	private pairingMutation: Promise<unknown> = Promise.resolve();
	private readonly pendingLinks = new Map<string, Set<RemoteConnection>>();
	private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly deviceClaims = new Map<string, Promise<void>>();
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
				handleRequest: (pairingId, request, link) => this.handleRequest(pairingId, request, link),
				toRemoteError,
				onLinkOnline: (deviceId, link) =>
					void this.handleLinkOnline(deviceId, link).catch((error: unknown) =>
						log.warn("remote link online handling failed", { error: describe(error) }),
					),
				onDeviceOnline: (deviceId, link) =>
					void this.handleDeviceOnline(deviceId, link.channel).catch((error: unknown) =>
						log.warn("remote device online handling failed", { error: describe(error) }),
					),
				onDeviceOffline: (deviceId) => {
					this.screenShare.forget(deviceId);
					this.handleDeviceOffline();
				},
				onLinksChanged: () => this.stateChanged(),
			},
			{ offlineGraceMs: options.hubGraceMs },
		);
		this.screenShare = new RemoteScreenShare({
			permissions: options.screenPermissions ?? { screenAllowed: () => true, inputAllowed: () => true },
			hostFor: (deviceId) => this.desktopHosts.get(deviceId),
			emit: (deviceId, status) => void this.hub.emit(deviceId, "screen.status", status).catch(() => undefined),
			notifyMissing: (deviceId, missing) =>
				this.options.notifications.screenPermissionMissing?.({
					deviceName: this.deviceForPairing(deviceId)?.name || "手机",
					...missing,
				}),
			pollMs: options.screenPermissionPollMs,
			readCursor: options.readCursor,
			emitCursor: (deviceId, cursor) => void this.hub.emit(deviceId, "screen.cursor", cursor).catch(() => undefined),
		});
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
				online: this.hub.isOnline(pairingIdOf(device)),
				channels: this.hub.onlineChannels(pairingIdOf(device)),
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
		this.config = await this.options.store.restorePairings();
		await this.cleanupRetiredPairings();
		if (this.config.devices.length === 0) return;
		await this.reconcile();
	}

	async shutdown(): Promise<void> {
		await this.pairingMutation;
		for (const timer of this.pendingTimers.values()) clearTimeout(timer);
		this.pendingTimers.clear();
		for (const connections of this.pendingLinks.values()) {
			for (const connection of connections) await connection.close().catch(() => undefined);
		}
		this.pendingLinks.clear();
		if (this.invite) clearTimeout(this.invite.timer);
		this.invite = undefined;
		for (const approval of this.approvals.values()) approval.resolve(false);
		this.approvals.clear();
		this.screenShare.stop();
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

	createInvite(): Promise<RemoteAccessState> {
		return this.mutatePairings(async () => {
			if (!this.options.store.vaultAvailable()) throw new Error("remote credential storage unavailable");
			await this.discardInvite();
			const pairingId = randomToken(24);
			const expiresAt = this.now() + this.inviteTtlMs;
			const mobileSecret = randomToken(32);
			try {
				this.options.store.putMobileSecret(pairingId, mobileSecret);
				this.options.store.putRelaySecret(pairingId, randomToken(32));
				this.config = await this.options.store.update((current) => ({
					...current,
					pendingPairings: [
						...(current.pendingPairings ?? []),
						{
							pairingId,
							expiresAt,
							mobileSecretHash: sha256Hex(mobileSecret),
						},
					],
				}));
			} catch (error) {
				this.options.store.clearPairingSecrets(pairingId);
				throw error;
			}
			const timer = setTimeout(
				() =>
					void this.expireInvite(pairingId).catch((error: unknown) =>
						log.warn("remote invite expiry failed", { error: describe(error) }),
					),
				this.inviteTtlMs,
			);
			timer.unref?.();
			this.invite = { pairingId, expiresAt, timer };
			await this.reconcile();
			void this.publishInviteCode(pairingId);
			return this.getState();
		});
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

	cancelInvite(): Promise<RemoteAccessState> {
		return this.mutatePairings(async () => {
			await this.discardInvite();
			return this.getState();
		});
	}

	private async discardInvite(): Promise<void> {
		const invite = this.invite;
		if (!invite) return;
		this.config = await this.options.store.update((current) => ({
			...current,
			pendingPairings: current.pendingPairings?.filter((pending) => pending.pairingId !== invite.pairingId),
			retiredPairingIds: [...(current.retiredPairingIds ?? []), invite.pairingId],
		}));
		clearTimeout(invite.timer);
		this.invite = undefined;
		await this.disposePairing(invite.pairingId);
		await this.reconcile();
	}

	revokeDevice(id: string): Promise<RemoteAccessState> {
		return this.mutatePairings(async () => {
			const device = this.config.devices.find((entry) => entry.id === id);
			if (!device) return this.getState();
			this.config = await this.options.store.update((current) => ({
				...current,
				devices: current.devices.filter((entry) => entry.id !== id),
				retiredPairingIds: [...(current.retiredPairingIds ?? []), pairingIdOf(device)],
			}));
			const pairingId = pairingIdOf(device);
			if (this.hub.isOnline(pairingId)) await this.hub.emit(pairingId, "device.revoked").catch(() => undefined);
			await this.disposePairing(pairingId);
			await this.reconcile();
			return this.getState();
		});
	}

	private async disposePairing(pairingId: string): Promise<void> {
		clearTimeout(this.pendingTimers.get(pairingId));
		this.pendingTimers.delete(pairingId);
		for (const connection of this.pendingLinks.get(pairingId) ?? []) await connection.close().catch(() => undefined);
		this.pendingLinks.delete(pairingId);
		this.screenShare.forget(pairingId);
		this.screenOnDemand.delete(pairingId);
		this.hostOnDemand.delete(pairingId);
		await this.hub.drop(pairingId);
		await this.desktopHosts
			.get(pairingId)
			?.stop()
			.catch(() => undefined);
		this.desktopHosts.delete(pairingId);
		this.desktopHostStarts.delete(pairingId);
		await this.relayLinks.get(pairingId)?.stop();
		this.relayLinks.delete(pairingId);
		this.lanLinks.delete(pairingId);
		await this.cleanupRetiredPairings();
	}

	private async cleanupRetiredPairings(): Promise<void> {
		try {
			this.config = await this.options.store.cleanupRetiredPairings();
		} catch (error) {
			log.warn("retired pairing credential cleanup will retry on restart", { error: describe(error) });
		}
	}

	private mutatePairings<T>(action: () => Promise<T>): Promise<T> {
		const result = this.pairingMutation.then(action);
		this.pairingMutation = result.catch(() => undefined);
		return result;
	}

	renameDevice(id: string, name: string): Promise<RemoteAccessState> {
		return this.mutatePairings(() => this.updateRenameDevice(id, name));
	}

	private async updateRenameDevice(id: string, name: string): Promise<RemoteAccessState> {
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
	setDesktopControl(id: string, enabled: boolean): Promise<RemoteAccessState> {
		return this.mutatePairings(() => this.updateSetDesktopControl(id, enabled));
	}

	private async updateSetDesktopControl(id: string, enabled: boolean): Promise<RemoteAccessState> {
		const device = this.config.devices.find((entry) => entry.id === id);
		if (!device) return this.getState();
		const pairingId = pairingIdOf(device);
		await this.options.store.patchDevice(id, { desktopControl: enabled });
		this.config = await this.options.store.read();
		this.stateChanged();
		if (enabled) {
			if (this.hub.isOnline(pairingId)) void this.startDesktopHost(pairingId);
		} else {
			this.screenShare.forget(pairingId);
			await this.desktopHosts
				.get(pairingId)
				?.stop()
				.catch(() => undefined);
			this.desktopHosts.delete(pairingId);
		}
		if (this.hub.isOnline(pairingId))
			await this.hub.emit(pairingId, "device.status", this.deviceStatus(pairingId)).catch(() => undefined);
		log.info("remote desktop control changed", { pairingId: id.slice(0, 6), enabled });
		return this.getState();
	}

	/**
	 * Moves access away from this network to another relay, or back to the default one
	 * (`undefined`). Connected phones hear the new address first, so they follow instead
	 * of losing the relay; the current QR code, made for the old relay, is replaced.
	 */
	setRelayBaseUrl(value: string | undefined): Promise<RemoteAccessState> {
		return this.mutatePairings(() => this.updateSetRelayBaseUrl(value));
	}

	private async updateSetRelayBaseUrl(value: string | undefined): Promise<RemoteAccessState> {
		const typed = value?.trim();
		const normalized = typed ? normalizeRelayBaseUrl(typed) : undefined;
		if (typed && !normalized) throw new Error("invalid relay address");
		const fallback = this.options.store.defaultRelayBaseUrl();
		const stored = normalized === fallback ? undefined : normalized;
		const next = stored ?? fallback;
		if (next === this.config.relayBaseUrl) return this.getState();
		for (const device of this.config.devices) {
			if (!this.hub.isOnline(pairingIdOf(device))) continue;
			await this.hub
				.emit(pairingIdOf(device), "device.status", {
					...this.deviceStatus(pairingIdOf(device)),
					relayBaseUrl: next,
				})
				.catch(() => undefined);
		}
		this.config = await this.options.store.update((current) => ({ ...current, relayBaseUrl: stored }));
		for (const link of this.relayLinks.values()) await link.stop();
		this.relayLinks.clear();
		for (const host of this.desktopHosts.values()) await host.stop().catch(() => undefined);
		this.desktopHosts.clear();
		await this.discardInvite();
		await this.reconcile();
		for (const device of this.config.devices) {
			if (this.hub.isOnline(pairingIdOf(device))) void this.startDesktopHost(pairingIdOf(device));
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

	setCloudEnabled(enabled: boolean): Promise<RemoteAccessState> {
		return this.mutatePairings(() => this.updateSetCloudEnabled(enabled));
	}

	private async updateSetCloudEnabled(enabled: boolean): Promise<RemoteAccessState> {
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
		const pairings = this.pairings();
		const needed = pairings.length > 0;
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
				journalFor: (pairingId) => this.journalForPairing(pairingId),
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
		const activeIds = new Set(pairings.map((device) => device.id));
		for (const [id, link] of [...this.relayLinks]) {
			if (!wantRelay || !activeIds.has(id)) {
				await link.stop();
				this.relayLinks.delete(id);
			}
		}
		if (!wantRelay || !this.config.relayBaseUrl) return;
		for (const device of pairings) {
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
				journal: this.journalForPairing(device.id),
				onConnection: (connection) => {
					this.attachConnection(device.id, { channel: "relay", connection });
				},
			});
			this.relayLinks.set(device.id, link);
			link.start();
		}
	}

	private journalForPairing(pairingId: string) {
		// A competing invitation claimant must never replay the winner's device history.
		return this.deviceForPairing(pairingId) ? this.hub.journalFor(pairingId) : new RemoteEventJournal();
	}

	private deviceForPairing(pairingId: string): RemoteControlDeviceRecord | undefined {
		return this.config.devices.find((device) => pairingIdOf(device) === pairingId);
	}

	private pairings(): LanDeviceCredential[] {
		return [
			...this.config.devices.map((device) => ({
				id: pairingIdOf(device),
				mobileSecretHash: device.mobileSecretHash,
				mobileIdentityKey: device.mobileIdentityKey,
			})),
			...(this.config.pendingPairings ?? [])
				.filter((pending) => pending.expiresAt > this.now())
				.map((pending) => ({
					id: pending.pairingId,
					mobileSecretHash: pending.mobileSecretHash,
					mobileIdentityKey: pending.mobileIdentityKey,
				})),
		];
	}

	private credentialFor(pairingId: string): LanDeviceCredential | undefined {
		return this.pairings().find((pairing) => pairing.id === pairingId);
	}

	private decideDeviceHello(device: LanDeviceCredential, hello: RemoteHello): RemoteHelloDecision {
		const current = this.credentialFor(device.id);
		if (!current || (current.mobileIdentityKey && current.mobileIdentityKey !== hello.identityKey))
			return { kind: "reject", reason: "pairing is no longer available" };
		return { kind: "approve" };
	}

	private attachConnection(pairingId: string, link: RemoteDeviceLink): () => void {
		if (this.deviceForPairing(pairingId)) return this.hub.attach(pairingId, link);
		// Pending invitations must not join the device hub: another claimant could otherwise
		// receive the winner's traffic while its own unpinned handshake is still outstanding.
		const pending = this.pendingLinks.get(pairingId) ?? new Set<RemoteConnection>();
		pending.add(link.connection);
		this.pendingLinks.set(pairingId, pending);
		const removePending = () => {
			pending.delete(link.connection);
			if (!pending.size) this.pendingLinks.delete(pairingId);
		};
		const requests: RemoteRequest[] = [];
		let admitting = false;
		let detach: (() => void) | undefined;
		const stop = link.connection.onEvent((event) => {
			if (
				event.type === "state" &&
				(event.state === "closed" || event.state === "failed" || event.state === "reconnecting")
			) {
				removePending();
				stop();
				return;
			}
			if (event.type === "remote-request") {
				if (requests.length >= 32) void link.connection.close();
				else requests.push(event.request);
			}
			if (event.type !== "peer-authenticated" || admitting) return;
			const snapshot = link.connection.getSnapshot();
			if (!snapshot.peerIdentityKey) return;
			admitting = true;
			void this.claim(pairingId, snapshot.peerIdentityKey, snapshot.peerDeviceName)
				.then(async () => {
					const device = this.deviceForPairing(pairingId);
					const current = link.connection.getSnapshot();
					if (
						device?.mobileIdentityKey !== snapshot.peerIdentityKey ||
						current.peerIdentityKey !== snapshot.peerIdentityKey
					)
						throw new Error("pairing identity changed");
					if (current.state !== "online") return;
					stop();
					removePending();
					link.connection.adoptEventJournal(this.hub.journalFor(pairingId));
					detach = this.hub.attach(pairingId, link);
					for (const request of requests) {
						try {
							const payload = await this.handleRequest(pairingId, request, link);
							await link.connection.respond(request.requestId, { success: true, payload });
						} catch (error) {
							await link.connection
								.respond(request.requestId, { success: false, error: toRemoteError(error) })
								.catch(() => undefined);
						}
					}
				})
				.catch((error: unknown) => {
					log.warn("remote pairing admission failed", { error: describe(error) });
					removePending();
					stop();
					void link.connection.close();
				});
		});
		return () => {
			removePending();
			stop();
			detach?.();
		};
	}

	private async handleRequest(pairingId: string, request: RemoteRequest, link: RemoteDeviceLink): Promise<unknown> {
		const device = this.deviceForPairing(pairingId);
		if (!device?.mobileIdentityKey || device.mobileIdentityKey !== link.connection.getSnapshot().peerIdentityKey)
			throw new RemoteOperationError("unauthorized", "pairing is no longer available");
		return request.method === "screen.subscribe"
			? this.subscribeScreen(pairingId, request.payload)
			: this.requireMirror().handleRequest(request);
	}

	private claim(pairingId: string, identityKey: string, name: string | undefined): Promise<void> {
		const active = this.deviceClaims.get(pairingId);
		if (active) return active;
		const claim = this.mutatePairings(async () => {
			if (this.deviceForPairing(pairingId)) return;
			const result = await this.options.store.completePairing(pairingId, identityKey, name, this.now());
			this.config = result.config;
			clearTimeout(this.pendingTimers.get(pairingId));
			this.pendingTimers.delete(pairingId);
			if (this.invite?.pairingId === pairingId) {
				clearTimeout(this.invite.timer);
				this.invite = undefined;
			}
			// Replacement retires the old connection without telling the same phone to erase its new pairing.
			for (const retired of result.retired) await this.disposePairing(retired);
			await this.relayLinks.get(pairingId)?.stop();
			this.relayLinks.delete(pairingId);
			await this.reconcile();
			await this.cleanupRetiredPairings();
		}).finally(() => {
			if (this.deviceClaims.get(pairingId) === claim) this.deviceClaims.delete(pairingId);
		});
		this.deviceClaims.set(pairingId, claim);
		return claim;
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
			const detach = this.attachConnection(kind.id, { channel: "lan", connection: link.connection });
			const set = this.lanLinks.get(kind.id) ?? new Set();
			set.add(detach);
			this.lanLinks.set(kind.id, set);
			return;
		}
		// Manual pairing: once the person approved and the handshake finished,
		// mint the device and hand the phone its long-lived credential over the
		// encrypted link. The phone then reconnects on the normal path.
		const unsubscribe = link.connection.onEvent((event) => {
			if (event.type === "peer-authenticated") {
				unsubscribe();
				void this.finishManualPairing(link.connection, link.peerIdentityKey()).catch((error: unknown) => {
					log.warn("remote manual pairing failed", { error: describe(error) });
					void link.connection.close();
				});
			} else if (event.type === "state" && (event.state === "failed" || event.state === "closed")) {
				unsubscribe();
			}
		});
	}

	private async finishManualPairing(connection: RemoteConnection, peerIdentityKey: string | undefined): Promise<void> {
		if (!peerIdentityKey) {
			await connection.close();
			return;
		}
		const pairingId = randomToken(24);
		const mobileSecret = randomToken(32);
		const relaySecret = randomToken(32);
		this.options.store.putRelaySecret(pairingId, relaySecret);
		await this.mutatePairings(async () => {
			this.config = await this.options.store.update((current) => ({
				...current,
				pendingPairings: [
					...(current.pendingPairings ?? []),
					{
						pairingId,
						mobileSecretHash: sha256Hex(mobileSecret),
						mobileIdentityKey: peerIdentityKey,
						expiresAt: this.now() + this.inviteTtlMs,
					},
				],
			}));
			await this.reconcile();
		});
		const port = this.lanServer?.listeningPort;
		const expiry = setTimeout(
			() =>
				void this.mutatePairings(async () => {
					if (this.deviceForPairing(pairingId)) return;
					this.config = await this.options.store.update((current) => ({
						...current,
						pendingPairings: current.pendingPairings?.filter((pending) => pending.pairingId !== pairingId),
						retiredPairingIds: [...(current.retiredPairingIds ?? []), pairingId],
					}));
					await this.disposePairing(pairingId);
					await this.reconcile();
				}).catch((error: unknown) => log.warn("remote manual pairing expiry failed", { error: describe(error) })),
			this.inviteTtlMs,
		);
		expiry.unref?.();
		this.pendingTimers.set(pairingId, expiry);
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

	private async handleLinkOnline(deviceId: string, link: RemoteDeviceLink): Promise<void> {
		const { channel, connection } = link;
		const device = this.deviceForPairing(deviceId);
		if (!device) return;
		const snapshot = connection.getSnapshot();
		if (snapshot.peerIdentityKey !== device.mobileIdentityKey) {
			await connection.close();
			return;
		}
		// Before any await: the screen host started for this phone right after reads it.
		if (snapshot.peerCapabilities) this.screenOnDemand.set(deviceId, snapshot.peerCapabilities.screen === true);
		if (snapshot.peerCapabilities?.screen === true && device.screenOnDemand !== true) {
			void this.rememberScreenOnDemand(deviceId);
		}

		// A phone renamed since pairing (or paired before its name was kept) shows its current name,
		// unless the name was chosen on this desktop.
		const name = device.renamed ? undefined : snapshot.peerDeviceName?.trim();
		// Only a "last seen" time and the name: failing to save them must not keep the phone from being served.
		try {
			await this.options.store.patchDevice(
				device.id,
				{
					lastSeenAt: this.now(),
					...(name && name !== device.name ? { name } : {}),
				},
				deviceId,
			);
			this.config = await this.options.store.read();
		} catch (error) {
			log.warn("remote device last-seen save failed", { pairingId: deviceId.slice(0, 6), error: describe(error) });
		}
		if (!this.deviceForPairing(deviceId)) {
			await connection.close();
			return;
		}
		await this.hub.emitToLink(deviceId, link, "device.status", this.deviceStatus(deviceId)).catch(() => undefined);
		log.info("remote link online", { pairingId: deviceId.slice(0, 6), channel });
		// The screen may have gone while this link was reconnecting; the phone never counted as
		// offline (the grace period covers a brief absence), so nothing else would bring it back.
		if (channel !== "p2p") void this.startDesktopHost(deviceId);
	}

	private async handleDeviceOnline(deviceId: string, channel: RemoteChannel): Promise<void> {
		const device = this.deviceForPairing(deviceId);
		if (!device) return;
		this.options.notifications.deviceConnected({ id: device.id, name: device?.name || "手机", channel });
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
		if (this.deviceForPairing(deviceId)?.desktopControl === false) return;
		if (this.desktopHosts.has(deviceId) || this.desktopHostStarts.has(deviceId)) return;
		this.desktopHostStarts.add(deviceId);
		try {
			// A host still stopping would be handed back instead of a new one.
			await this.desktopHostStops.get(deviceId)?.catch(() => undefined);
			const onDemand = this.capturesOnDemand(deviceId);
			const host = await controller.start({
				relayBaseUrl,
				pairingId: deviceId,
				desktopSecret,
				screenOnDemand: onDemand,
			});
			if (!this.hub.isOnline(deviceId)) {
				await host.stop();
				return;
			}
			const device = this.deviceForPairing(deviceId);
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
			this.hostOnDemand.set(deviceId, onDemand);
			const detach = this.hub.attach(deviceId, { channel: "p2p", connection });
			let released = false;
			const release = (): void => {
				if (released) return;
				released = true;
				unsubscribe();
				detach();
				if (this.desktopHosts.get(deviceId) === host) {
					this.desktopHosts.delete(deviceId);
					this.hostOnDemand.delete(deviceId);
				}
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
			// A phone that kept the screen open across a dropped P2P link sees it again.
			await this.screenShare.hostReady(deviceId);
		} catch (error) {
			log.warn("remote desktop host failed to start", { deviceId: deviceId.slice(0, 6), error: describe(error) });
		} finally {
			this.desktopHostStarts.delete(deviceId);
		}
	}

	private async subscribeScreen(deviceId: string, payload: unknown): Promise<unknown> {
		const fields =
			typeof payload === "object" && payload !== null ? (payload as { active?: unknown; cursor?: unknown }) : {};
		const active = fields.active;
		if (typeof active !== "boolean") throw new RemoteOperationError("invalid_frame", "screen.subscribe needs active");
		const device = this.deviceForPairing(deviceId);
		if (active && device?.desktopControl === false) {
			throw new RemoteOperationError("forbidden", "This desktop does not share its screen with this phone");
		}
		if (active && !this.capturesOnDemand(deviceId)) {
			// Only a phone that captures on demand subscribes. Over the relay its handshake did
			// not say so, and its host streams the whole time: remember it, and replace that host.
			this.screenOnDemand.set(deviceId, true);
			await this.rememberScreenOnDemand(deviceId);
			if (this.hostOnDemand.get(deviceId) === false) {
				log.info("remote desktop host restarts to capture on demand", { pairingId: deviceId.slice(0, 6) });
				await this.desktopHosts
					.get(deviceId)
					?.stop()
					.catch(() => undefined);
			}
		}
		return this.screenShare.subscribe(deviceId, active, fields.cursor === true);
	}

	/** Said in this phone's handshake, or learnt earlier and kept with its pairing. */
	private capturesOnDemand(deviceId: string): boolean {
		return this.screenOnDemand.get(deviceId) ?? this.deviceForPairing(deviceId)?.screenOnDemand === true;
	}

	private async rememberScreenOnDemand(deviceId: string): Promise<void> {
		const device = this.deviceForPairing(deviceId);
		if (!device) return;
		try {
			await this.options.store.patchDevice(device.id, { screenOnDemand: true }, deviceId);
			this.config = await this.options.store.read();
		} catch (error) {
			log.warn("remote device screen mode save failed", { pairingId: deviceId.slice(0, 6), error: describe(error) });
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
		const device = deviceId ? this.deviceForPairing(deviceId) : undefined;
		return {
			deviceName: this.options.deviceName,
			osLabel: this.options.osLabel,
			lanEndpoints: port ? this.lanEndpoints(port) : [],
			relayEnabled: this.config.cloudEnabled && Boolean(this.config.relayBaseUrl),
			runningSessionCount: this.options.runningSessionCount(),
			fileRead: DESKTOP_REMOTE_CAPABILITIES.fileRead === true,
			screen: DESKTOP_REMOTE_CAPABILITIES.screen === true,
			toolResult: DESKTOP_REMOTE_CAPABILITIES.toolResult === true,
			actions: DESKTOP_REMOTE_CAPABILITIES.actions === true,
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
		await this.mutatePairings(async () => {
			if (this.invite?.pairingId === pairingId) await this.discardInvite();
		});
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
