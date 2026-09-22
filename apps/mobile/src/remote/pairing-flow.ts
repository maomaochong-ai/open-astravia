import {
	decodePublicKey,
	isValidHostPort,
	lanControlUrl,
	parsePairingUri,
	RemoteConnection,
	type RemotePairingInvite,
	type RemoteTransport,
	readDevicePaired,
	relayControlUrl,
	toBase64Url,
} from "@vetta/remote-control";
import type { DesktopRecord, LinkIdentity, TransportFactory } from "./types";

export const MANUAL_PAIRING_PATH = "/v2/lan/pair";

export type PairingPhase =
	| { readonly kind: "idle" }
	| { readonly kind: "connecting"; readonly via: "lan" | "relay" | "manual" }
	| { readonly kind: "awaiting_approval"; readonly verificationCode: string; readonly desktopName?: string }
	| { readonly kind: "paired"; readonly desktop: DesktopRecord }
	| { readonly kind: "failed"; readonly reason: PairingFailure };

export type PairingFailure = "invalid_code" | "rejected" | "unauthorized" | "unreachable" | "invalid_endpoint";

export interface PairingFlowOptions {
	readonly link: LinkIdentity;
	readonly createTransport: TransportFactory;
	readonly onPhase: (phase: PairingPhase) => void;
	readonly timeoutMs?: number;
	readonly approvalTimeoutMs?: number;
	readonly now?: () => number;
}

/**
 * Turns a scanned QR code or a typed `host:port` into a persisted desktop
 * record. Both paths end with a `RemoteConnection` that reached `online`
 * against the desktop's pinned identity key; the manual path additionally
 * waits for the desktop to hand over the long-lived credential.
 */
export class PairingFlow {
	private cancelled = false;
	private connections: RemoteConnection[] = [];

	constructor(private readonly options: PairingFlowOptions) {}

	async cancel(): Promise<void> {
		this.cancelled = true;
		const connections = this.connections;
		this.connections = [];
		await Promise.all(connections.map((connection) => connection.close().catch(() => undefined)));
	}

	async pairWithCode(text: string): Promise<DesktopRecord | undefined> {
		let invite: RemotePairingInvite;
		try {
			invite = parsePairingUri(text);
		} catch {
			this.fail("invalid_code");
			return undefined;
		}
		const attempts: { via: "lan" | "relay"; url: string }[] = invite.lanEndpoints.map((endpoint) => ({
			via: "lan" as const,
			url: lanControlUrl(endpoint, invite.pairingId),
		}));
		if (invite.relayBaseUrl)
			attempts.push({ via: "relay", url: relayControlUrl(invite.relayBaseUrl, invite.pairingId, "mobile") });
		if (attempts.length === 0) {
			this.fail("invalid_code");
			return undefined;
		}
		let lastFailure: PairingFailure = "unreachable";
		for (const attempt of attempts) {
			if (this.cancelled) return undefined;
			this.options.onPhase({ kind: "connecting", via: attempt.via });
			const outcome = await this.connectOnce(attempt.url, {
				pairingSecret: invite.mobileSecret,
				expectedPeerIdentityKey: decodePublicKey(invite.desktopIdentityKey),
				timeoutMs:
					attempt.via === "lan"
						? (this.options.timeoutMs ?? 4_000)
						: Math.max(this.options.timeoutMs ?? 4_000, 8_000),
			});
			if (outcome.kind === "online") {
				const now = this.options.now?.() ?? Date.now();
				const record: DesktopRecord = {
					desktopIdentityKey: invite.desktopIdentityKey,
					desktopName: invite.desktopName,
					pairingId: invite.pairingId,
					mobileSecret: invite.mobileSecret,
					lanEndpoints: invite.lanEndpoints,
					relayBaseUrl: invite.relayBaseUrl,
					lastEventSequence: 0,
					pairedAt: now,
					lastSeenAt: now,
				};
				await outcome.connection.close().catch(() => undefined);
				this.options.onPhase({ kind: "paired", desktop: record });
				return record;
			}
			lastFailure = outcome.reason;
			if (outcome.reason === "unauthorized" || outcome.reason === "rejected") break;
		}
		this.fail(lastFailure);
		return undefined;
	}

	async pairManually(endpoint: string): Promise<DesktopRecord | undefined> {
		const trimmed = endpoint.trim();
		if (!isValidHostPort(trimmed)) {
			this.fail("invalid_endpoint");
			return undefined;
		}
		this.options.onPhase({ kind: "connecting", via: "manual" });
		const url = `ws://${trimmed}${MANUAL_PAIRING_PATH}`;
		const outcome = await this.connectOnce(url, {
			manual: true,
			timeoutMs: this.options.timeoutMs ?? 4_000,
			approvalTimeoutMs: this.options.approvalTimeoutMs ?? 120_000,
		});
		if (outcome.kind !== "online") {
			this.fail(outcome.reason);
			return undefined;
		}
		const paired = await this.waitForPaired(outcome.connection, this.options.approvalTimeoutMs ?? 120_000);
		await outcome.connection.close().catch(() => undefined);
		if (!paired) {
			this.fail("unreachable");
			return undefined;
		}
		const peerKey = outcome.connection.getSnapshot().peerIdentityKey;
		if (!peerKey) {
			this.fail("unreachable");
			return undefined;
		}
		const now = this.options.now?.() ?? Date.now();
		const record: DesktopRecord = {
			desktopIdentityKey: peerKey,
			desktopName: paired.desktopName,
			pairingId: paired.pairingId,
			mobileSecret: paired.mobileSecret,
			lanEndpoints: paired.lanEndpoints.length > 0 ? paired.lanEndpoints : [trimmed],
			relayBaseUrl: paired.relayBaseUrl,
			lastEventSequence: 0,
			pairedAt: now,
			lastSeenAt: now,
		};
		this.options.onPhase({ kind: "paired", desktop: record });
		return record;
	}

	private connectOnce(
		url: string,
		input: {
			pairingSecret?: string;
			manual?: boolean;
			expectedPeerIdentityKey?: Uint8Array;
			timeoutMs: number;
			approvalTimeoutMs?: number;
		},
	): Promise<{ kind: "online"; connection: RemoteConnection } | { kind: "failed"; reason: PairingFailure }> {
		const inner = this.options.createTransport(url, { pairingSecret: input.pairingSecret, manual: input.manual });
		// The acceptor explains a rejection only through the close reason, which
		// RemoteConnection does not surface; observe it at the transport seam.
		let closeReason: string | undefined;
		const transport: RemoteTransport = {
			connect: (handlers) =>
				inner.connect({
					onFrame: handlers.onFrame,
					onClose: (reason) => {
						closeReason = reason;
						handlers.onClose(reason);
					},
				}),
			send: (frame) => inner.send(frame),
			close: (reason) => inner.close(reason),
		};
		const connection = new RemoteConnection(transport, {
			role: "mobile",
			deviceId: this.options.link.deviceId,
			deviceName: this.options.link.deviceName,
			capabilities: { chat: true, sessionRead: true },
			identity: this.options.link.identity,
			expectedPeerIdentityKey: input.expectedPeerIdentityKey,
			now: this.options.now,
		});
		this.connections.push(connection);
		return new Promise((resolve) => {
			let settled = false;
			let timer = setTimeout(() => finish({ kind: "failed", reason: "unreachable" }), input.timeoutMs);
			const finish = (
				result: { kind: "online"; connection: RemoteConnection } | { kind: "failed"; reason: PairingFailure },
			) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				off();
				if (result.kind === "failed") void connection.close().catch(() => undefined);
				resolve(result);
			};
			const off = connection.onEvent((event) => {
				if (event.type === "state" && event.state === "online") finish({ kind: "online", connection });
				if (event.type === "state" && event.state === "pending_approval") {
					const code = connection.getSnapshot().verificationCode ?? "";
					this.options.onPhase({
						kind: "awaiting_approval",
						verificationCode: code,
						desktopName: connection.getSnapshot().peerDeviceId,
					});
					clearTimeout(timer);
					timer = setTimeout(
						() => finish({ kind: "failed", reason: "unreachable" }),
						input.approvalTimeoutMs ?? 120_000,
					);
				}
				if (event.type === "error" && event.error.code === "unauthorized")
					finish({ kind: "failed", reason: "unauthorized" });
				if (event.type === "state" && (event.state === "failed" || event.state === "reconnecting")) {
					finish({ kind: "failed", reason: classifyFailure(connection.getSnapshot().lastErrorCode, closeReason) });
				}
			});
			connection.connect().catch(() => finish({ kind: "failed", reason: "unreachable" }));
		});
	}

	private waitForPaired(connection: RemoteConnection, timeoutMs: number) {
		return new Promise<ReturnType<typeof readDevicePaired>>((resolve) => {
			const timer = setTimeout(() => {
				off();
				resolve(undefined);
			}, timeoutMs);
			const off = connection.onEvent((event) => {
				if (event.type !== "remote-event" || event.event.name !== "device.paired") return;
				const paired = readDevicePaired(event.event.payload);
				if (!paired) return;
				clearTimeout(timer);
				off();
				resolve(paired);
			});
		});
	}

	private fail(reason: PairingFailure): void {
		if (this.cancelled) return;
		this.options.onPhase({ kind: "failed", reason });
	}
}

function classifyFailure(code: string | undefined, closeReason: string | undefined): PairingFailure {
	if (code === "unauthorized") return "unauthorized";
	if (code === "approval_rejected") return "rejected";
	const reason = closeReason?.toLowerCase() ?? "";
	if (reason.includes("not approved") || reason.includes("rejected")) return "rejected";
	if (reason.includes("pinned key") || reason.includes("not paired") || reason.includes("unauthorized"))
		return "unauthorized";
	return "unreachable";
}

export function describeIdentity(identity: LinkIdentity): string {
	return toBase64Url(identity.identity.publicKey);
}
