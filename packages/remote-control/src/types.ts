export const REMOTE_PROTOCOL_VERSION = 1 as const;

export type RemoteRole = "mobile" | "desktop" | "relay";
export type RemoteConnectionState =
	| "idle"
	| "connecting"
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

export interface RemoteHello {
	readonly type: "hello";
	readonly protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
	readonly role: Exclude<RemoteRole, "relay">;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly capabilities: RemoteCapabilities;
	readonly connectionId: string;
}

export interface RemoteHelloAck {
	readonly type: "hello_ack";
	readonly protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
	readonly connectionId: string;
	readonly peerDeviceId: string;
}

export interface RemoteRequest {
	readonly type: "request";
	readonly requestId: string;
	readonly method:
		| "session.list"
		| "session.open"
		| "session.prompt"
		| "session.respond"
		| "session.abort"
		| "session.resume"
		| "diagnostics.snapshot";
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

export interface RemoteEvent {
	readonly type: "event";
	readonly eventId: string;
	readonly sequence: number;
	readonly name: RemoteEventName;
	readonly sessionId?: string;
	readonly payload?: unknown;
}

export type RemoteEventName =
	| "device.status"
	| "session.state"
	| "session.message"
	| "session.tool"
	| "session.input"
	| "diagnostics.updated";

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
		| "not_found"
		| "busy"
		| "request_timeout"
		| "transport_closed"
		| "internal_error";
	readonly message: string;
	readonly retryable: boolean;
}

export type RemoteFrame =
	| RemoteHello
	| RemoteHelloAck
	| RemoteRequest
	| RemoteResponse
	| RemoteEvent
	| RemoteAck
	| RemoteResume;

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
	close(): Promise<void>;
}

export interface RemoteTransportHandlers {
	onFrame(frame: RemoteFrame): void;
	onClose(reason?: string): void;
}

export interface RemoteConnectionOptions {
	readonly role: Exclude<RemoteRole, "relay">;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly capabilities: RemoteCapabilities;
	readonly connectionId?: string;
	readonly requestTimeoutMs?: number;
	readonly logger?: RemoteLogger;
	readonly now?: () => number;
}

export interface RemoteConnectionSnapshot extends RemoteDiagnostics {
	readonly peerDeviceId?: string;
}

export type RemoteConnectionEvent =
	| { readonly type: "state"; readonly state: RemoteConnectionState }
	| { readonly type: "remote-request"; readonly request: RemoteRequest }
	| { readonly type: "remote-event"; readonly event: RemoteEvent }
	| { readonly type: "error"; readonly error: RemoteError };
