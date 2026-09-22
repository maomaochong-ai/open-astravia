import {
	decodePublicKey,
	lanControlUrl,
	RemoteConnection,
	type RemoteConnection as RemoteConnectionType,
	type RemoteEvent,
	type RemoteRequestPayloads,
	type RemoteResponsePayloads,
	readDeviceStatus,
	relayControlUrl,
} from "@vetta/remote-control";
import type { DesktopRecord, LinkChannel, LinkIdentity, LinkSnapshot, TransportFactory } from "./types";

export interface ChannelManagerOptions {
	readonly desktop: DesktopRecord;
	readonly link: LinkIdentity;
	readonly createTransport: TransportFactory;
	readonly onSequence?: (lastEventSequence: number) => void;
	readonly onLanEndpoints?: (endpoints: readonly string[]) => void;
	readonly lanBudgetMs?: number;
	readonly lanProbeIntervalMs?: number;
	readonly keepaliveIntervalMs?: number;
	readonly requestTimeoutMs?: number;
	readonly maxBackoffMs?: number;
	readonly now?: () => number;
}

export type LinkEventListener = (event: RemoteEvent) => void;

interface Candidate {
	readonly channel: LinkChannel;
	readonly connection: RemoteConnectionType;
	readonly dispose: () => void;
}

const OFFLINE: LinkSnapshot = { status: "offline", channel: null, peerOnline: false, reconnectAttempt: 0 };

/**
 * One logical link to one desktop over two candidate channels. LAN endpoints
 * are raced first; the relay is the fallback. While on the relay a LAN probe
 * runs periodically and the link switches back silently when it succeeds. The
 * global event sequence lives here (not per connection) so a switch never
 * replays or drops anything.
 */
export class ChannelManager {
	private snapshot: LinkSnapshot = OFFLINE;
	private active: Candidate | undefined;
	private lanEndpoints: readonly string[];
	private lastEventSequence: number;
	private readonly listeners = new Set<(snapshot: LinkSnapshot) => void>();
	private readonly eventListeners = new Set<LinkEventListener>();
	private readonly lanBudgetMs: number;
	private readonly lanProbeIntervalMs: number;
	private readonly maxBackoffMs: number;
	private readonly now: () => number;
	private generation = 0;
	private running = false;
	private foreground = true;
	private attemptInFlight = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private probeTimer: ReturnType<typeof setTimeout> | undefined;
	private backoffMs = 1_000;
	private reconnectAttempt = 0;
	private rttTimer: ReturnType<typeof setInterval> | undefined;

	constructor(private readonly options: ChannelManagerOptions) {
		this.lanEndpoints = options.desktop.lanEndpoints;
		this.lastEventSequence = options.desktop.lastEventSequence;
		this.lanBudgetMs = options.lanBudgetMs ?? 1_500;
		this.lanProbeIntervalMs = options.lanProbeIntervalMs ?? 20_000;
		this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
		this.now = options.now ?? Date.now;
	}

	getSnapshot(): LinkSnapshot {
		return this.snapshot;
	}

	get sequence(): number {
		return this.lastEventSequence;
	}

	subscribe(listener: (snapshot: LinkSnapshot) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	onEvent(listener: LinkEventListener): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		void this.attempt();
	}

	/** App came to the foreground or the network changed: re-evaluate the best channel now. */
	refresh(): void {
		this.foreground = true;
		if (!this.running) return;
		this.clearReconnect();
		this.backoffMs = 1_000;
		if (this.snapshot.status === "online") {
			if (this.active?.channel === "relay") void this.probeLan();
			return;
		}
		void this.attempt();
	}

	setForeground(foreground: boolean): void {
		this.foreground = foreground;
		if (!foreground) this.clearProbe();
		else if (this.active?.channel === "relay") this.scheduleProbe();
	}

	async stop(): Promise<void> {
		this.running = false;
		this.generation += 1;
		this.clearReconnect();
		this.clearProbe();
		const active = this.active;
		this.active = undefined;
		if (active) {
			active.dispose();
			await active.connection.close();
		}
		this.publish(OFFLINE);
	}

	async request<M extends keyof RemoteRequestPayloads>(
		method: M,
		payload?: RemoteRequestPayloads[M],
		sessionId?: string,
	): Promise<RemoteResponsePayloads[M]> {
		const active = this.active;
		if (!active || this.snapshot.status !== "online") throw new LinkOfflineError();
		if (!this.snapshot.peerOnline) throw new LinkOfflineError();
		const result = await active.connection.request(method, payload, sessionId);
		this.publish({ ...this.snapshot, rttMs: active.connection.getSnapshot().lastRttMs });
		return result as RemoteResponsePayloads[M];
	}

	private async attempt(): Promise<void> {
		if (!this.running || this.attemptInFlight) return;
		this.attemptInFlight = true;
		const generation = this.generation;
		this.publish({ ...this.snapshot, status: "connecting", channel: null, reconnectAttempt: this.reconnectAttempt });
		try {
			const lan = await this.raceLan(generation);
			if (generation !== this.generation) {
				lan?.dispose();
				return;
			}
			if (lan) {
				this.adopt(lan);
				return;
			}
			const relay = await this.connectRelay(generation);
			if (generation !== this.generation) {
				relay?.dispose();
				return;
			}
			if (relay) {
				this.adopt(relay);
				this.scheduleProbe();
				return;
			}
			this.scheduleReconnect("unreachable");
		} finally {
			this.attemptInFlight = false;
		}
	}

	private adopt(candidate: Candidate): void {
		const previous = this.active;
		this.active = candidate;
		this.backoffMs = 1_000;
		this.reconnectAttempt = 0;
		this.clearReconnect();
		if (previous) {
			previous.dispose();
			void previous.connection.close().catch(() => undefined);
		}
		candidate.connection.onEvent((event) => {
			if (this.active !== candidate) return;
			if (event.type === "remote-event") {
				this.deliver(event.event);
				return;
			}
			if (event.type === "peer-status") {
				this.publish({ ...this.snapshot, peerOnline: event.online });
				return;
			}
			if (event.type === "state") {
				if (event.state === "reconnecting" || event.state === "failed" || event.state === "closed") {
					this.dropActive(candidate, candidate.connection.getSnapshot().lastErrorCode ?? event.state);
				} else if (event.state === "online" && this.snapshot.status !== "online") {
					this.publish({ ...this.snapshot, status: "online", peerOnline: true });
				}
				return;
			}
			if (event.type === "error" && event.error.code === "unauthorized") {
				this.publish({ ...this.snapshot, lastError: "unauthorized" });
			}
		});
		this.publish({
			status: "online",
			channel: candidate.channel,
			peerOnline: true,
			rttMs: candidate.connection.getSnapshot().lastRttMs,
			desktop: this.snapshot.desktop,
			reconnectAttempt: 0,
		});
		this.startRttSampling();
	}

	private dropActive(candidate: Candidate, reason: string): void {
		if (this.active !== candidate) return;
		this.active = undefined;
		this.stopRttSampling();
		candidate.dispose();
		void candidate.connection.close().catch(() => undefined);
		this.publish({ ...this.snapshot, status: "offline", channel: null, peerOnline: false, lastError: reason });
		this.clearProbe();
		this.scheduleReconnect(reason);
	}

	private deliver(event: RemoteEvent): void {
		if (event.name !== "session.resync" && event.sequence <= this.lastEventSequence) return;
		this.lastEventSequence = event.sequence;
		this.options.onSequence?.(event.sequence);
		if (event.name === "device.status") {
			const status = readDeviceStatus(event.payload);
			if (status) {
				if (status.lanEndpoints.length > 0 && !sameList(status.lanEndpoints, this.lanEndpoints)) {
					this.lanEndpoints = status.lanEndpoints;
					this.options.onLanEndpoints?.(status.lanEndpoints);
				}
				this.publish({ ...this.snapshot, desktop: status });
			}
		}
		for (const listener of this.eventListeners) listener(event);
	}

	private buildConnection(channel: LinkChannel, url: string): Candidate {
		const transport = this.options.createTransport(url, {
			pairingSecret: this.options.desktop.mobileSecret,
			keepaliveIntervalMs: this.options.keepaliveIntervalMs ?? 25_000,
		});
		const connection = new RemoteConnection(transport, {
			role: "mobile",
			deviceId: this.options.link.deviceId,
			deviceName: this.options.link.deviceName,
			capabilities: { chat: true, sessionRead: true },
			identity: this.options.link.identity,
			expectedPeerIdentityKey: decodePublicKey(this.options.desktop.desktopIdentityKey),
			resumeFrom: this.lastEventSequence,
			requestTimeoutMs: this.options.requestTimeoutMs,
			now: this.now,
		});
		let unsubscribe: (() => void) | undefined;
		const candidate: Candidate = {
			channel,
			connection,
			dispose: () => {
				unsubscribe?.();
				unsubscribe = undefined;
			},
		};
		// Events that arrive during the race (before adoption) must not be lost:
		// the desktop replays from `resumeFrom`, so a candidate can receive
		// journaled events immediately after coming online.
		unsubscribe = connection.onEvent((event) => {
			if (this.active === candidate) return;
			if (event.type === "remote-event") this.deliver(event.event);
		});
		return candidate;
	}

	private waitOnline(candidate: Candidate, timeoutMs: number): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			let settled = false;
			const finish = (value: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				off();
				resolve(value);
			};
			const off = candidate.connection.onEvent((event) => {
				if (event.type === "state" && event.state === "online") finish(true);
				if (event.type === "state" && (event.state === "failed" || event.state === "reconnecting")) finish(false);
				if (event.type === "error" && event.error.code === "unauthorized") {
					this.publish({ ...this.snapshot, lastError: "unauthorized" });
					finish(false);
				}
			});
			const timer = setTimeout(() => finish(false), timeoutMs);
			candidate.connection.connect().catch(() => finish(false));
		});
	}

	private async raceLan(generation: number): Promise<Candidate | undefined> {
		if (this.lanEndpoints.length === 0) return undefined;
		const candidates = this.lanEndpoints.map((endpoint) =>
			this.buildConnection("lan", lanControlUrl(endpoint, this.options.desktop.pairingId)),
		);
		const winner = await new Promise<Candidate | undefined>((resolve) => {
			let remaining = candidates.length;
			let done = false;
			for (const candidate of candidates) {
				void this.waitOnline(candidate, this.lanBudgetMs).then((online) => {
					if (done) return;
					if (online) {
						done = true;
						resolve(candidate);
						return;
					}
					remaining -= 1;
					if (remaining === 0) {
						done = true;
						resolve(undefined);
					}
				});
			}
		});
		for (const candidate of candidates) {
			if (candidate === winner && generation === this.generation) continue;
			candidate.dispose();
			void candidate.connection.close().catch(() => undefined);
		}
		return winner;
	}

	private async connectRelay(generation: number): Promise<Candidate | undefined> {
		const relay = this.options.desktop.relayBaseUrl;
		if (!relay) return undefined;
		const candidate = this.buildConnection("relay", relayControlUrl(relay, this.options.desktop.pairingId, "mobile"));
		const online = await this.waitOnline(candidate, Math.max(this.lanBudgetMs * 4, 8_000));
		if (!online || generation !== this.generation) {
			candidate.dispose();
			void candidate.connection.close().catch(() => undefined);
			return undefined;
		}
		return candidate;
	}

	private scheduleProbe(): void {
		this.clearProbe();
		if (!this.foreground || !this.running) return;
		this.probeTimer = setTimeout(() => {
			this.probeTimer = undefined;
			void this.probeLan();
		}, this.lanProbeIntervalMs);
		(this.probeTimer as { unref?: () => void }).unref?.();
	}

	private async probeLan(): Promise<void> {
		if (!this.running || this.active?.channel !== "relay") return;
		const generation = this.generation;
		const lan = await this.raceLan(generation);
		if (generation !== this.generation || !this.running) {
			lan?.dispose();
			return;
		}
		if (lan && this.active?.channel === "relay") {
			this.adopt(lan);
			return;
		}
		if (lan) {
			lan.dispose();
			void lan.connection.close().catch(() => undefined);
		}
		if (this.active?.channel === "relay") this.scheduleProbe();
	}

	private scheduleReconnect(reason: string): void {
		if (!this.running || this.reconnectTimer) return;
		this.reconnectAttempt += 1;
		const delay = this.backoffMs;
		this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
		this.publish({
			...this.snapshot,
			status: "offline",
			channel: null,
			peerOnline: false,
			lastError: reason,
			reconnectAttempt: this.reconnectAttempt,
		});
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			void this.attempt();
		}, delay);
		(this.reconnectTimer as { unref?: () => void }).unref?.();
	}

	private clearReconnect(): void {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = undefined;
	}

	private clearProbe(): void {
		if (this.probeTimer) clearTimeout(this.probeTimer);
		this.probeTimer = undefined;
	}

	private startRttSampling(): void {
		this.stopRttSampling();
		this.rttTimer = setInterval(() => {
			const active = this.active;
			if (!active || this.snapshot.status !== "online" || !this.snapshot.peerOnline || !this.foreground) return;
			void active.connection
				.request("diagnostics.snapshot")
				.then(() => this.publish({ ...this.snapshot, rttMs: active.connection.getSnapshot().lastRttMs }))
				.catch(() => undefined);
		}, 30_000);
		(this.rttTimer as { unref?: () => void }).unref?.();
	}

	private stopRttSampling(): void {
		if (this.rttTimer) clearInterval(this.rttTimer);
		this.rttTimer = undefined;
	}

	private publish(snapshot: LinkSnapshot): void {
		this.snapshot = snapshot;
		for (const listener of this.listeners) listener(snapshot);
	}
}

export class LinkOfflineError extends Error {
	constructor() {
		super("desktop is offline");
		this.name = "LinkOfflineError";
	}
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}
