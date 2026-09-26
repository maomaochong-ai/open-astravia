import type { RemoteConnection, RemoteError, RemoteEvent, RemoteEventName, RemoteRequest } from "@vetta/remote-control";
import { RemoteEventJournal } from "@vetta/remote-control";
import { getAppLogger } from "../logger.js";

export type RemoteChannel = "p2p" | "lan" | "relay";

export interface RemoteDeviceLink {
	readonly channel: RemoteChannel;
	readonly connection: RemoteConnection;
}

export interface RemoteDeviceHubHandlers {
	/** Serves a request that arrived from any link of the device. */
	readonly handleRequest: (deviceId: string, request: RemoteRequest) => Promise<unknown>;
	readonly toRemoteError: (error: unknown) => RemoteError;
	/** The first link of a device came online. */
	readonly onDeviceOnline?: (deviceId: string, link: RemoteDeviceLink) => void;
	/** The last link of a device went away (after the grace period). */
	readonly onDeviceOffline?: (deviceId: string) => void;
	/** A link on this device just completed its handshake (also fires for extra links). */
	readonly onLinkOnline?: (deviceId: string, link: RemoteDeviceLink) => void;
	/** Anything about a device's links changed: one came or went, or the device went offline. */
	readonly onLinksChanged?: (deviceId: string) => void;
}

export interface RemoteDeviceHubOptions {
	/** How long a device stays "online" after its last link drops, so a LAN→relay switch does not tear the mirror down. */
	readonly offlineGraceMs?: number;
	readonly journalCapacity?: number;
	readonly journalMaxAgeMs?: number;
	readonly now?: () => number;
}

interface DeviceEntry {
	readonly journal: RemoteEventJournal;
	readonly links: Set<RemoteDeviceLink>;
	readonly unsubscribes: Map<RemoteDeviceLink, () => void>;
	online: boolean;
	offlineTimer?: ReturnType<typeof setTimeout>;
}

const log = getAppLogger("remote-hub");

/**
 * Routes events through the best live link of a paired phone and accepts
 * requests from any link. One journal per device keeps the event sequence
 * continuous across P2P, LAN and relay switches.
 */
export class DesktopRemoteDeviceHub {
	private readonly devices = new Map<string, DeviceEntry>();
	private readonly offlineGraceMs: number;

	constructor(
		private readonly handlers: RemoteDeviceHubHandlers,
		private readonly options: RemoteDeviceHubOptions = {},
	) {
		this.offlineGraceMs = options.offlineGraceMs ?? 5_000;
	}

	journalFor(deviceId: string): RemoteEventJournal {
		return this.entry(deviceId).journal;
	}

	attach(deviceId: string, link: RemoteDeviceLink): () => void {
		const entry = this.entry(deviceId);
		entry.links.add(link);
		const unsubscribe = link.connection.onEvent((event) => {
			if (event.type === "remote-request") {
				void this.serve(deviceId, link, event.request);
				return;
			}
			if (event.type === "state") {
				if (event.state === "online") this.markLinkOnline(deviceId, entry, link);
				else if (event.state === "closed" || event.state === "failed") this.detach(deviceId, link);
				else if (event.state === "reconnecting") this.reevaluate(deviceId, entry);
				this.handlers.onLinksChanged?.(deviceId);
			}
		});
		entry.unsubscribes.set(link, unsubscribe);
		if (link.connection.getSnapshot().state === "online") this.markLinkOnline(deviceId, entry, link);
		return () => this.detach(deviceId, link);
	}

	detach(deviceId: string, link: RemoteDeviceLink): void {
		const entry = this.devices.get(deviceId);
		if (!entry || !entry.links.has(link)) return;
		entry.links.delete(link);
		entry.unsubscribes.get(link)?.();
		entry.unsubscribes.delete(link);
		this.reevaluate(deviceId, entry);
		this.handlers.onLinksChanged?.(deviceId);
	}

	/** Closes every link of a device and forgets its journal (revocation). */
	async drop(deviceId: string): Promise<void> {
		const entry = this.devices.get(deviceId);
		if (!entry) return;
		if (entry.offlineTimer) clearTimeout(entry.offlineTimer);
		for (const link of [...entry.links]) {
			entry.unsubscribes.get(link)?.();
			await link.connection.close().catch(() => undefined);
		}
		const wasOnline = entry.online;
		this.devices.delete(deviceId);
		if (wasOnline) this.handlers.onDeviceOffline?.(deviceId);
		this.handlers.onLinksChanged?.(deviceId);
	}

	async dropAll(): Promise<void> {
		for (const deviceId of [...this.devices.keys()]) await this.drop(deviceId);
	}

	isOnline(deviceId: string): boolean {
		return this.devices.get(deviceId)?.online === true;
	}

	onlineChannels(deviceId: string): RemoteChannel[] {
		const entry = this.devices.get(deviceId);
		if (!entry) return [];
		return [...entry.links]
			.filter((link) => link.connection.getSnapshot().state === "online")
			.map((link) => link.channel);
	}

	onlineDeviceIds(): string[] {
		return [...this.devices.entries()].filter(([, entry]) => entry.online).map(([deviceId]) => deviceId);
	}

	hasOnlineDevices(): boolean {
		return this.onlineDeviceIds().length > 0;
	}

	/** Sequences one event for a device and delivers it on its best live link. */
	async emit(deviceId: string, name: RemoteEventName, payload?: unknown, sessionId?: string): Promise<RemoteEvent> {
		const entry = this.entry(deviceId);
		const sequence = entry.journal.nextSequence();
		const event: RemoteEvent = {
			type: "event",
			eventId: `${deviceId}-event-${sequence}`,
			sequence,
			name,
			sessionId,
			payload,
		};
		entry.journal.remember(event);
		for (const link of preferredOnlineLinks(entry.links)) {
			try {
				await link.connection.deliverEvent(event);
				break;
			} catch (error) {
				log.debug("remote event delivery failed", { deviceId, channel: link.channel, error: describe(error) });
			}
		}
		return event;
	}

	/** Emits to every device that currently has a live link. */
	async broadcast(name: RemoteEventName, payload?: unknown, sessionId?: string): Promise<void> {
		for (const deviceId of this.onlineDeviceIds()) await this.emit(deviceId, name, payload, sessionId);
	}

	private async serve(deviceId: string, link: RemoteDeviceLink, request: RemoteRequest): Promise<void> {
		try {
			const payload = await this.handlers.handleRequest(deviceId, request);
			await link.connection.respond(request.requestId, { success: true, payload });
		} catch (error) {
			const remoteError = this.handlers.toRemoteError(error);
			await link.connection
				.respond(request.requestId, { success: false, error: remoteError })
				.catch((sendError: unknown) => {
					log.debug("remote error response failed", { deviceId, error: describe(sendError) });
				});
		}
	}

	private markLinkOnline(deviceId: string, entry: DeviceEntry, link: RemoteDeviceLink): void {
		if (entry.offlineTimer) {
			clearTimeout(entry.offlineTimer);
			entry.offlineTimer = undefined;
		}
		const first = !entry.online;
		entry.online = true;
		this.handlers.onLinkOnline?.(deviceId, link);
		if (first) this.handlers.onDeviceOnline?.(deviceId, link);
	}

	private reevaluate(deviceId: string, entry: DeviceEntry): void {
		if (!entry.online) return;
		const anyOnline = [...entry.links].some((link) => link.connection.getSnapshot().state === "online");
		if (anyOnline || entry.offlineTimer) return;
		entry.offlineTimer = setTimeout(() => {
			entry.offlineTimer = undefined;
			const stillOnline = [...entry.links].some((link) => link.connection.getSnapshot().state === "online");
			if (stillOnline || !entry.online) return;
			entry.online = false;
			this.handlers.onDeviceOffline?.(deviceId);
			this.handlers.onLinksChanged?.(deviceId);
		}, this.offlineGraceMs);
		entry.offlineTimer.unref?.();
	}

	private entry(deviceId: string): DeviceEntry {
		let entry = this.devices.get(deviceId);
		if (!entry) {
			entry = {
				journal: new RemoteEventJournal({
					capacity: this.options.journalCapacity ?? 2_048,
					maxAgeMs: this.options.journalMaxAgeMs ?? 10 * 60_000,
					now: this.options.now,
				}),
				links: new Set(),
				unsubscribes: new Map(),
				online: false,
			};
			this.devices.set(deviceId, entry);
		}
		return entry;
	}
}

const CHANNEL_PRIORITY: Readonly<Record<RemoteChannel, number>> = { p2p: 0, lan: 1, relay: 2 };

function preferredOnlineLinks(links: ReadonlySet<RemoteDeviceLink>): RemoteDeviceLink[] {
	return [...links]
		.filter((link) => link.connection.getSnapshot().state === "online")
		.sort((left, right) => CHANNEL_PRIORITY[left.channel] - CHANNEL_PRIORITY[right.channel]);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
