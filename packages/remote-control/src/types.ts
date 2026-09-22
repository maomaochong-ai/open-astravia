export const REMOTE_PROTOCOL_VERSION = 2 as const;

export type RemoteRole = "mobile" | "desktop" | "relay";
export type RemoteConnectionState =
	| "idle"
	| "connecting"
	| "pending_approval"
	| "online"
	| "recovering"
	| "reconnecting"
	| "closed"
	| "failed";

export interface RemoteCapabilities {
	readonly chat: boolean;
	readonly sessionRead: boolean;
	readonly fileRead?: boolean;
	readonly fileWrite?: boolean;
	readonly terminal?: boolean;
	readonly screen?: boolean;
	readonly input?: boolean;
}

/**
 * Plaintext handshake. Both identity and ephemeral keys are X25519 public keys
 * encoded as base64url without padding. The relay reads this frame to validate
 * the declared role and to copy the keys into the peer's `hello_ack`; it never
 * sees anything after the handshake in clear.
 */
export interface RemoteHello {
	readonly type: "hello";
	readonly protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
	readonly role: Exclude<RemoteRole, "relay">;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly capabilities: RemoteCapabilities;
	readonly connectionId: string;
	readonly identityKey: string;
	readonly ephemeralKey: string;
}

export interface RemoteHelloAck {
	readonly type: "hello_ack";
	readonly protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
	readonly connectionId: string;
	readonly peerDeviceId: string;
	readonly peerIdentityKey: string;
	readonly peerEphemeralKey: string;
}

/**
 * Sent by an acceptor (the desktop LAN server) when a manual pairing needs the
 * person at the desktop to compare the verification code and approve.
 */
export interface RemotePairingPending {
	readonly type: "pairing_pending";
	readonly connectionId: string;
	readonly peerDeviceId: string;
	readonly peerIdentityKey: string;
}

/** Emitted by a relay or an acceptor when the other endpoint comes or goes. */
export interface RemotePeerStatus {
	readonly type: "peer_status";
	readonly online: boolean;
}

/** Encrypted envelope around any post-handshake frame. */
export interface RemoteSealed {
	readonly type: "sealed";
	readonly nonce: string;
	readonly ciphertext: string;
}

export type RemoteRequestMethod =
	| "project.list"
	| "session.list"
	| "session.create"
	| "session.open"
	| "session.history"
	| "session.prompt"
	| "session.respond"
	| "session.abort"
	| "session.resume"
	| "diagnostics.snapshot";

export interface RemoteRequest {
	readonly type: "request";
	readonly requestId: string;
	readonly method: RemoteRequestMethod;
	readonly sessionId?: string;
	readonly payload?: unknown;
}

export interface RemoteResponse {
	readonly type: "response";
	readonly requestId: string;
	readonly success: boolean;
	readonly payload?: unknown;
	readonly error?: RemoteError;
}

export type RemoteEventName =
	| "device.status"
	| "device.paired"
	| "session.list"
	| "session.state"
	| "session.message"
	| "session.tool"
	| "session.input"
	| "session.resync"
	| "diagnostics.updated";

export interface RemoteEvent {
	readonly type: "event";
	readonly eventId: string;
	readonly sequence: number;
	readonly name: RemoteEventName;
	readonly sessionId?: string;
	readonly payload?: unknown;
}

export interface RemoteAck {
	readonly type: "ack";
	readonly sequence: number;
}

export interface RemoteResume {
	readonly type: "resume";
	readonly lastEventSequence: number;
}

export interface RemoteError {
	readonly code:
		| "invalid_frame"
		| "unsupported_version"
		| "unauthorized"
		| "approval_rejected"
		| "not_found"
		| "busy"
		| "request_timeout"
		| "transport_closed"
		| "internal_error";
	readonly message: string;
	readonly retryable: boolean;
}

/** Frames that may travel in clear: the handshake and relay-owned status. */
export type RemoteHandshakeFrame = RemoteHello | RemoteHelloAck | RemotePairingPending | RemotePeerStatus;

/** Frames that must travel inside a `sealed` envelope after the handshake. */
export type RemoteSessionFrame = RemoteRequest | RemoteResponse | RemoteEvent | RemoteAck | RemoteResume;

export type RemoteFrame = RemoteHandshakeFrame | RemoteSealed | RemoteSessionFrame;

export interface RemoteDiagnostics {
	readonly state: RemoteConnectionState;
	readonly deviceId: string;
	readonly connectionId: string;
	readonly lastEventSequence: number;
	readonly lastAckSequence: number;
	readonly pendingRequestCount: number;
	readonly reconnectCount: number;
	readonly lastRttMs?: number;
	readonly lastErrorCode?: RemoteError["code"];
}

export interface RemoteLogger {
	debug(message: string, fields?: Record<string, string | number | boolean | undefined>): void;
	info(message: string, fields?: Record<string, string | number | boolean | undefined>): void;
	warn(message: string, fields?: Record<string, string | number | boolean | undefined>): void;
}

export const NOOP_REMOTE_LOGGER: RemoteLogger = {
	debug: () => undefined,
	info: () => undefined,
	warn: () => undefined,
};

export interface RemoteTransport {
	connect(handlers: RemoteTransportHandlers): Promise<void>;
	send(frame: RemoteFrame): Promise<void>;
	/** `reason` is surfaced to the peer where the transport can carry it (WebSocket close reason). */
	close(reason?: string): Promise<void>;
}

export interface RemoteTransportHandlers {
	onFrame(frame: RemoteFrame): void;
	onClose(reason?: string): void;
}

export interface RemoteIdentityKeyPair {
	readonly publicKey: Uint8Array;
	readonly secretKey: Uint8Array;
}

/**
 * Decision returned by an acceptor when a peer's plaintext `hello` arrives.
 * `approve` completes the handshake; `pending` asks the person at the acceptor
 * to compare the verification code first; `reject` closes the transport.
 */
export type RemoteHelloDecision =
	| { readonly kind: "approve" }
	| { readonly kind: "pending"; readonly approval: Promise<boolean> }
	| { readonly kind: "reject"; readonly reason: string };

export interface RemoteEventJournalPort {
	nextSequence(): number;
	remember(event: RemoteEvent): void;
	acknowledge(sequence: number): void;
	/** Events newer than `afterSequence`, or `undefined` when they have already been evicted. */
	replay(afterSequence: number): readonly RemoteEvent[] | undefined;
	readonly lastSequence: number;
}

export interface RemoteConnectionOptions {
	readonly role: Exclude<RemoteRole, "relay">;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly capabilities: RemoteCapabilities;
	readonly identity: RemoteIdentityKeyPair;
	/**
	 * `initiate` sends `hello` and waits for `hello_ack` (both relay clients and
	 * the mobile side of a LAN link). `accept` waits for the peer's `hello` and
	 * answers with `hello_ack` (the desktop LAN server).
	 */
	readonly handshake?: "initiate" | "accept";
	/** Pinned peer identity; a peer presenting another key is rejected before any secret is derived. */
	readonly expectedPeerIdentityKey?: Uint8Array;
	/** Acceptor-only hook that decides whether an unknown peer may pair. Defaults to approving pinned peers only. */
	readonly onHello?: (hello: RemoteHello) => Promise<RemoteHelloDecision> | RemoteHelloDecision;
	/** Shared outbound journal so events survive a channel switch. Defaults to a per-connection journal. */
	readonly journal?: RemoteEventJournalPort;
	/** Highest event sequence already received from this peer; sent after the handshake so the peer replays newer ones. */
	readonly resumeFrom?: number;
	readonly connectionId?: string;
	readonly requestTimeoutMs?: number;
	readonly logger?: RemoteLogger;
	readonly now?: () => number;
	readonly randomBytes?: (length: number) => Uint8Array;
}

export interface RemoteConnectionSnapshot extends RemoteDiagnostics {
	readonly peerDeviceId?: string;
	readonly peerIdentityKey?: string;
	/** Six-digit code both ends can display to confirm a manual pairing. */
	readonly verificationCode?: string;
}

export type RemoteConnectionEvent =
	| { readonly type: "state"; readonly state: RemoteConnectionState }
	| { readonly type: "remote-request"; readonly request: RemoteRequest }
	| { readonly type: "remote-event"; readonly event: RemoteEvent }
	| { readonly type: "peer-status"; readonly online: boolean }
	| { readonly type: "error"; readonly error: RemoteError };
