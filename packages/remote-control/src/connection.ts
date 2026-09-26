import {
	bytesEqual,
	decodePublicKey,
	defaultRandomBytes,
	deriveSessionKeys,
	generateIdentityKeyPair,
	openFrame,
	type RemoteSessionKeys,
	sealFrame,
	toBase64Url,
	verificationCode,
} from "./crypto.js";
import { RemoteEventJournal } from "./event-journal.js";
import { decodeRemoteFrame, RemoteProtocolError } from "./protocol.js";
import type {
	RemoteConnectionEvent,
	RemoteConnectionOptions,
	RemoteConnectionSnapshot,
	RemoteConnectionState,
	RemoteDiagnostics,
	RemoteError,
	RemoteEvent,
	RemoteEventJournalPort,
	RemoteEventName,
	RemoteFrame,
	RemoteHello,
	RemoteHelloAck,
	RemoteIdentityKeyPair,
	RemotePairingPending,
	RemoteRequest,
	RemoteResponse,
	RemoteSealed,
	RemoteSessionFrame,
	RemoteTransport,
} from "./types.js";
import { NOOP_REMOTE_LOGGER, REMOTE_PROTOCOL_VERSION } from "./types.js";

interface PendingRequest {
	readonly request: RemoteRequest;
	readonly resolve: (payload: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly startedAt: number;
	readonly timeout: ReturnType<typeof setTimeout>;
}

const SEALED_ASSOCIATED_DATA = `vetta-remote-v${REMOTE_PROTOCOL_VERSION}`;
const EARLY_SEALED_LIMIT = 32;

/**
 * One end of a remote link over one transport. Handles the plaintext handshake,
 * derives the session keys, seals everything after that, correlates requests
 * and keeps the inbound event sequence continuous. Outbound events go through a
 * journal that may be shared across transports, so a peer that reconnects on
 * another channel only receives what it missed.
 */
export class RemoteConnection {
	private state: RemoteConnectionState = "idle";
	private readonly connectionId: string;
	private readonly logger;
	private readonly now: () => number;
	private readonly randomBytes;
	private readonly requestTimeoutMs: number;
	private readonly handshake: "initiate" | "accept";
	private readonly journal: RemoteEventJournalPort;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly listeners = new Set<(event: RemoteConnectionEvent) => void>();
	private ephemeral: RemoteIdentityKeyPair | undefined;
	private keys: RemoteSessionKeys | undefined;
	private peerDeviceId: string | undefined;
	private peerIdentityKey: Uint8Array | undefined;
	private lastEventSequence: number;
	private lastAckSequence = 0;
	private reconnectCount = 0;
	private lastRttMs: number | undefined;
	private lastErrorCode: RemoteError["code"] | undefined;
	private requestCounter = 0;
	/**
	 * Sealed frames that arrived before our own handshake completed. A relay
	 * acknowledges both ends in one step, so the peer's first sealed frame can
	 * legitimately overtake our `hello_ack`; hold a few instead of failing.
	 */
	private readonly earlySealed: RemoteSealed[] = [];
	/** The peer's connection id of the handshake this acceptor last took part in. */
	private handshakeConnectionId: string | undefined;

	constructor(
		private readonly transport: RemoteTransport,
		private readonly options: RemoteConnectionOptions,
	) {
		this.connectionId = options.connectionId ?? `conn-${options.deviceId}-${Math.random().toString(36).slice(2, 10)}`;
		this.logger = options.logger ?? NOOP_REMOTE_LOGGER;
		this.now = options.now ?? Date.now;
		this.randomBytes = options.randomBytes ?? defaultRandomBytes;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
		this.handshake = options.handshake ?? "initiate";
		this.journal = options.journal ?? new RemoteEventJournal({ now: this.now });
		this.lastEventSequence = options.resumeFrom ?? 0;
	}

	onEvent(listener: (event: RemoteConnectionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getSnapshot(): RemoteConnectionSnapshot {
		return {
			state: this.state,
			deviceId: this.options.deviceId,
			connectionId: this.connectionId,
			peerDeviceId: this.peerDeviceId,
			peerIdentityKey: this.peerIdentityKey ? toBase64Url(this.peerIdentityKey) : undefined,
			verificationCode: this.peerIdentityKey
				? verificationCode(this.options.identity.publicKey, this.peerIdentityKey)
				: undefined,
			lastEventSequence: this.lastEventSequence,
			lastAckSequence: this.lastAckSequence,
			pendingRequestCount: this.pending.size,
			reconnectCount: this.reconnectCount,
			lastRttMs: this.lastRttMs,
			lastErrorCode: this.lastErrorCode,
		};
	}

	async connect(): Promise<void> {
		if (this.state === "online" || this.state === "connecting" || this.state === "pending_approval") return;
		this.setState(this.state === "idle" ? "connecting" : "reconnecting");
		this.ephemeral = generateIdentityKeyPair(this.randomBytes);
		this.keys = undefined;
		this.earlySealed.length = 0;
		try {
			await this.transport.connect({
				onFrame: (frame) => this.handleFrame(frame),
				onClose: (reason) => this.handleClose(reason),
			});
			if (this.handshake === "initiate") await this.transport.send(this.buildHello());
		} catch (error) {
			this.setState("failed");
			throw error;
		}
		this.logger.info("remote connection handshake started", {
			deviceId: this.options.deviceId,
			connectionId: this.connectionId,
			handshake: this.handshake,
		});
	}

	async close(): Promise<void> {
		if (this.state === "closed") return;
		this.rejectPending("remote connection closed");
		this.setState("closed");
		this.keys = undefined;
		await this.transport.close();
	}

	async request(method: RemoteRequest["method"], payload?: unknown, sessionId?: string): Promise<unknown> {
		if (this.state !== "online") throw new Error(`remote connection is ${this.state}`);
		const request: RemoteRequest = {
			type: "request",
			requestId: `${this.connectionId}-${this.now()}-${this.requestCounter++}`,
			method,
			sessionId,
			payload,
		};
		return await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(request.requestId);
				const error = new Error(`remote request timed out: ${method}`);
				this.lastErrorCode = "request_timeout";
				this.emit({ type: "error", error: { code: "request_timeout", message: error.message, retryable: true } });
				reject(error);
			}, this.requestTimeoutMs);
			this.pending.set(request.requestId, { request, resolve, reject, startedAt: this.now(), timeout });
			void this.sendSealed(request).catch((error: unknown) => {
				clearTimeout(timeout);
				this.pending.delete(request.requestId);
				reject(error instanceof Error ? error : new Error(String(error)));
			});
		});
	}

	async respond(
		requestId: string,
		response: { success: true; payload?: unknown } | { success: false; error: RemoteError },
	): Promise<void> {
		if (this.state !== "online") throw new Error(`remote connection is ${this.state}`);
		await this.sendSealed({ type: "response", requestId, ...response });
	}

	/**
	 * Records the event in the journal and delivers it when online. Offline
	 * events are still sequenced so they replay once the peer resumes.
	 */
	async emitEvent(name: RemoteEventName, payload?: unknown, sessionId?: string): Promise<RemoteEvent> {
		const sequence = this.journal.nextSequence();
		const event: RemoteEvent = {
			type: "event",
			eventId: `${this.options.deviceId}-event-${sequence}`,
			sequence,
			name,
			sessionId,
			payload,
		};
		this.journal.remember(event);
		if (this.state === "online") await this.sendSealed(event);
		return event;
	}

	/**
	 * Delivers an event that another component already sequenced through the
	 * shared journal (a hub fanning one event out to several links). Offline
	 * links skip it; the journal replays it when they resume.
	 */
	async deliverEvent(event: RemoteEvent): Promise<void> {
		if (this.state !== "online") return;
		await this.sendSealed(event);
	}

	private buildHello(): RemoteHello {
		if (!this.ephemeral) throw new Error("remote connection has no ephemeral key");
		return {
			type: "hello",
			protocolVersion: REMOTE_PROTOCOL_VERSION,
			role: this.options.role,
			deviceId: this.options.deviceId,
			deviceName: this.options.deviceName,
			capabilities: this.options.capabilities,
			connectionId: this.connectionId,
			identityKey: toBase64Url(this.options.identity.publicKey),
			ephemeralKey: toBase64Url(this.ephemeral.publicKey),
		};
	}

	private handleFrame(frame: RemoteFrame): void {
		let safeFrame: RemoteFrame;
		try {
			safeFrame = decodeRemoteFrame(frame);
		} catch (error) {
			this.protocolViolation(error instanceof Error ? error.message : "invalid frame");
			return;
		}
		switch (safeFrame.type) {
			case "hello":
				if (this.handshake !== "accept") this.protocolViolation("unexpected hello");
				else if (this.state !== "online") void this.handleInboundHello(safeFrame);
				else this.handlePeerRestart(safeFrame);
				return;
			case "hello_ack":
				if (this.handshake === "initiate") this.handleHelloAck(safeFrame);
				else this.protocolViolation("unexpected hello_ack");
				return;
			case "pairing_pending":
				if (this.handshake === "initiate") this.handlePairingPending(safeFrame);
				else this.protocolViolation("unexpected pairing_pending");
				return;
			case "peer_status":
				if (!safeFrame.online) this.rejectPending("remote peer is offline");
				this.emit({ type: "peer-status", online: safeFrame.online });
				return;
			case "sealed":
				if (!this.keys) {
					if (
						this.handshake === "initiate" &&
						this.isHandshaking() &&
						this.earlySealed.length < EARLY_SEALED_LIMIT
					) {
						this.earlySealed.push(safeFrame);
						return;
					}
					this.protocolViolation("sealed frame before handshake");
					return;
				}
				this.openSealed(safeFrame);
				return;
			default:
				this.protocolViolation(`plaintext ${safeFrame.type} frame`);
		}
	}

	/**
	 * A transport that outlives one peer connection (the remote desktop's data channel
	 * stays with the host while the phone rebuilds its WebRTC link) can carry a fresh
	 * hello while this side is online. That is the peer starting over, not an attack
	 * surface: the same pinned identity is required, so the session re-keys in place.
	 * A repeated hello for the connection already agreed on is ignored.
	 */
	private handlePeerRestart(hello: RemoteHello): void {
		if (hello.connectionId === this.handshakeConnectionId) {
			this.logger.debug("remote duplicate hello ignored", { connectionId: this.connectionId });
			return;
		}
		this.logger.info("remote peer restarted its connection", {
			connectionId: this.connectionId,
			peerConnectionId: hello.connectionId,
		});
		this.rejectPending("remote peer reconnected");
		this.reconnectCount += 1;
		this.keys = undefined;
		this.ephemeral = generateIdentityKeyPair(this.randomBytes);
		void this.handleInboundHello(hello);
	}

	private async handleInboundHello(hello: RemoteHello): Promise<void> {
		this.handshakeConnectionId = hello.connectionId;
		let peerIdentityKey: Uint8Array;
		try {
			peerIdentityKey = decodePublicKey(hello.identityKey, "identityKey");
		} catch {
			this.protocolViolation("hello identity key is invalid");
			return;
		}
		if (this.options.expectedPeerIdentityKey && !bytesEqual(this.options.expectedPeerIdentityKey, peerIdentityKey)) {
			this.fail("unauthorized", "peer identity does not match the pinned key");
			return;
		}
		this.peerIdentityKey = peerIdentityKey;
		this.peerDeviceId = hello.deviceId;
		const decision = this.options.onHello
			? await this.options.onHello(hello)
			: this.options.expectedPeerIdentityKey
				? ({ kind: "approve" } as const)
				: ({ kind: "reject", reason: "peer is not paired" } as const);
		if (this.state === "closed") return;
		if (decision.kind === "reject") {
			this.fail("unauthorized", decision.reason);
			return;
		}
		if (decision.kind === "pending") {
			this.setState("pending_approval");
			try {
				await this.transport.send({
					type: "pairing_pending",
					connectionId: hello.connectionId,
					peerDeviceId: this.options.deviceId,
					peerIdentityKey: toBase64Url(this.options.identity.publicKey),
				});
			} catch (error) {
				this.logger.warn("remote pairing_pending send failed", { error: describe(error) });
				return;
			}
			const approved = await decision.approval.catch(() => false);
			if (this.state !== "pending_approval") return;
			if (!approved) {
				this.fail("approval_rejected", "pairing was not approved");
				return;
			}
		}
		if (!this.ephemeral) return;
		try {
			this.keys = deriveSessionKeys({
				role: this.options.role,
				identity: this.options.identity,
				ephemeral: this.ephemeral,
				peerIdentityKey,
				peerEphemeralKey: decodePublicKey(hello.ephemeralKey, "ephemeralKey"),
			});
			await this.transport.send({
				type: "hello_ack",
				protocolVersion: REMOTE_PROTOCOL_VERSION,
				connectionId: hello.connectionId,
				peerDeviceId: this.options.deviceId,
				peerIdentityKey: toBase64Url(this.options.identity.publicKey),
				peerEphemeralKey: toBase64Url(this.ephemeral.publicKey),
			} satisfies RemoteHelloAck);
		} catch (error) {
			this.protocolViolation(describe(error));
			return;
		}
		this.goOnline();
	}

	private handleHelloAck(frame: RemoteHelloAck): void {
		// A relay can have more than one connection attempt in flight while a
		// client is recovering. Only accept the acknowledgement for this
		// connection; a stale acknowledgement must not make the new transport
		// appear online.
		if (frame.connectionId !== this.connectionId) {
			this.logger.warn("remote hello acknowledgement belongs to another connection", {
				connectionId: this.connectionId,
				ackConnectionId: frame.connectionId,
			});
			return;
		}
		if (!this.ephemeral) return;
		let peerIdentityKey: Uint8Array;
		try {
			peerIdentityKey = decodePublicKey(frame.peerIdentityKey, "peerIdentityKey");
		} catch {
			this.protocolViolation("hello_ack identity key is invalid");
			return;
		}
		if (this.options.expectedPeerIdentityKey && !bytesEqual(this.options.expectedPeerIdentityKey, peerIdentityKey)) {
			this.fail("unauthorized", "peer identity does not match the pinned key");
			return;
		}
		try {
			this.keys = deriveSessionKeys({
				role: this.options.role,
				identity: this.options.identity,
				ephemeral: this.ephemeral,
				peerIdentityKey,
				peerEphemeralKey: decodePublicKey(frame.peerEphemeralKey, "peerEphemeralKey"),
			});
		} catch (error) {
			this.protocolViolation(describe(error));
			return;
		}
		this.peerIdentityKey = peerIdentityKey;
		this.peerDeviceId = frame.peerDeviceId;
		this.goOnline();
	}

	private handlePairingPending(frame: RemotePairingPending): void {
		if (frame.connectionId !== this.connectionId) return;
		try {
			this.peerIdentityKey = decodePublicKey(frame.peerIdentityKey, "peerIdentityKey");
		} catch {
			this.protocolViolation("pairing_pending identity key is invalid");
			return;
		}
		if (
			this.options.expectedPeerIdentityKey &&
			!bytesEqual(this.options.expectedPeerIdentityKey, this.peerIdentityKey)
		) {
			this.fail("unauthorized", "peer identity does not match the pinned key");
			return;
		}
		this.peerDeviceId = frame.peerDeviceId;
		this.setState("pending_approval");
	}

	private isHandshaking(): boolean {
		return this.state === "connecting" || this.state === "reconnecting" || this.state === "pending_approval";
	}

	private openSealed(sealed: RemoteSealed): void {
		if (!this.keys) return;
		let inner: RemoteSessionFrame;
		try {
			inner = openFrame(this.keys.receiveKey, sealed, SEALED_ASSOCIATED_DATA);
		} catch (error) {
			this.protocolViolation(error instanceof Error ? error.message : "sealed frame rejected");
			return;
		}
		this.handleSessionFrame(inner);
	}

	private goOnline(): void {
		this.setState("online");
		const early = this.earlySealed.splice(0);
		for (const sealed of early) {
			if (this.state !== "online") return;
			this.openSealed(sealed);
		}
		this.logger.info("remote connection online", {
			deviceId: this.options.deviceId,
			peerDeviceId: this.peerDeviceId,
			connectionId: this.connectionId,
		});
		// Tell the peer what we already hold so it replays only the missing tail.
		void this.sendSealed({ type: "resume", lastEventSequence: this.lastEventSequence }).catch((error: unknown) => {
			this.logger.warn("remote resume request failed", { error: describe(error) });
		});
	}

	private handleSessionFrame(frame: RemoteSessionFrame): void {
		switch (frame.type) {
			case "request":
				this.emit({ type: "remote-request", request: frame });
				return;
			case "response":
				this.handleResponse(frame);
				return;
			case "event":
				this.handleEvent(frame);
				return;
			case "ack":
				this.lastAckSequence = Math.max(this.lastAckSequence, frame.sequence);
				this.journal.acknowledge(frame.sequence);
				return;
			case "resume":
				void this.replay(frame.lastEventSequence);
				return;
		}
	}

	private async replay(afterSequence: number): Promise<void> {
		const events = this.journal.replay(afterSequence);
		try {
			if (events === undefined) {
				// The tail was evicted; the peer must reload state instead of
				// waiting for a continuous sequence that no longer exists.
				await this.emitEvent("session.resync");
				return;
			}
			// Keys exist as soon as the handshake derived them, which can be a
			// moment before the state flips to online on an acceptor; sending
			// is what matters, so do not gate on the state here.
			for (const event of events) await this.sendSealed(event);
		} catch (error) {
			this.logger.warn("remote event replay failed", { error: describe(error) });
		}
	}

	private handleResponse(frame: RemoteResponse): void {
		const pending = this.pending.get(frame.requestId);
		if (!pending) {
			this.logger.warn("remote response has no pending request", { requestId: frame.requestId });
			return;
		}
		this.pending.delete(frame.requestId);
		clearTimeout(pending.timeout);
		this.lastRttMs = Math.max(0, this.now() - pending.startedAt);
		if (frame.success) pending.resolve(frame.payload);
		else {
			this.lastErrorCode = frame.error?.code ?? "internal_error";
			const error = new Error(frame.error?.message ?? "remote request failed");
			this.emit({
				type: "error",
				error: frame.error ?? { code: "internal_error", message: error.message, retryable: false },
			});
			pending.reject(error);
		}
	}

	private handleEvent(event: RemoteEvent): void {
		if (event.name === "session.resync") {
			// An explicit reset: adopt the peer's sequence and let the
			// application reload whatever it was tracking.
			this.lastEventSequence = event.sequence;
			if (this.state === "recovering") this.setState("online");
			this.emit({ type: "remote-event", event });
			this.acknowledge(event.sequence);
			return;
		}
		if (event.sequence <= this.lastEventSequence) {
			this.logger.debug("duplicate remote event ignored", { sequence: event.sequence, eventId: event.eventId });
			return;
		}
		if (event.sequence !== this.lastEventSequence + 1) {
			this.lastErrorCode = "transport_closed";
			this.logger.warn("remote event sequence gap", {
				expected: this.lastEventSequence + 1,
				received: event.sequence,
			});
			this.setState("recovering");
			void this.sendSealed({ type: "resume", lastEventSequence: this.lastEventSequence }).catch((error: unknown) => {
				this.logger.warn("remote event recovery request failed", { error: describe(error) });
			});
			return;
		}
		this.lastEventSequence = event.sequence;
		if (this.state === "recovering") this.setState("online");
		this.emit({ type: "remote-event", event });
		this.acknowledge(event.sequence);
	}

	private acknowledge(sequence: number): void {
		void this.sendSealed({ type: "ack", sequence }).catch((error: unknown) => {
			this.logger.warn("remote event ack failed", { sequence, error: describe(error) });
		});
	}

	private async sendSealed(frame: RemoteSessionFrame): Promise<void> {
		if (!this.keys) throw new Error("remote connection has no session keys");
		await this.transport.send(
			sealFrame(this.keys.sendKey, frame, SEALED_ASSOCIATED_DATA, { randomBytes: this.randomBytes }),
		);
	}

	private protocolViolation(reason: string): void {
		this.logger.warn("remote protocol violation", { connectionId: this.connectionId, reason });
		this.fail("invalid_frame", reason);
	}

	private fail(code: RemoteError["code"], message: string): void {
		this.lastErrorCode = code;
		this.emit({ type: "error", error: { code, message, retryable: code === "invalid_frame" } });
		this.rejectPending(message);
		this.keys = undefined;
		this.setState("failed");
		void this.transport.close(message).catch(() => undefined);
	}

	private handleClose(reason?: string): void {
		if (this.state === "closed") return;
		this.reconnectCount += 1;
		this.keys = undefined;
		this.rejectPending("remote transport closed");
		this.logger.warn("remote transport closed", {
			deviceId: this.options.deviceId,
			connectionId: this.connectionId,
			reason,
			reconnectCount: this.reconnectCount,
		});
		if (this.state !== "failed") this.setState("reconnecting");
	}

	private rejectPending(message: string): void {
		if (this.pending.size > 0) this.lastErrorCode = "transport_closed";
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(new Error(message));
		}
		this.pending.clear();
	}

	private setState(state: RemoteConnectionState): void {
		if (this.state === state) return;
		this.state = state;
		this.emit({ type: "state", state });
	}

	private emit(event: RemoteConnectionEvent): void {
		for (const listener of this.listeners) listener(event);
	}
}

export function diagnosticsFromSnapshot(snapshot: RemoteConnectionSnapshot): RemoteDiagnostics {
	return snapshot;
}

function describe(error: unknown): string {
	if (error instanceof RemoteProtocolError) return error.message;
	return error instanceof Error ? error.message : String(error);
}
