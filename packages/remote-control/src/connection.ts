import { decodeRemoteFrame } from "./protocol.js";
import type {
	RemoteConnectionEvent,
	RemoteConnectionOptions,
	RemoteConnectionSnapshot,
	RemoteConnectionState,
	RemoteDiagnostics,
	RemoteError,
	RemoteEvent,
	RemoteEventName,
	RemoteFrame,
	RemoteHelloAck,
	RemoteRequest,
	RemoteResponse,
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

export class RemoteConnection {
	private state: RemoteConnectionState = "idle";
	private readonly connectionId: string;
	private readonly logger;
	private readonly now: () => number;
	private readonly requestTimeoutMs: number;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly listeners = new Set<(event: RemoteConnectionEvent) => void>();
	private peerDeviceId: string | undefined;
	private lastEventSequence = 0;
	private lastAckSequence = 0;
	private reconnectCount = 0;
	private lastRttMs: number | undefined;
	private lastErrorCode: RemoteError["code"] | undefined;
	private requestCounter = 0;
	private outboundEventSequence = 0;
	private readonly outboundEvents = new Map<number, RemoteEvent>();

	constructor(
		private readonly transport: RemoteTransport,
		private readonly options: RemoteConnectionOptions,
	) {
		this.connectionId = options.connectionId ?? `conn-${options.deviceId}-${Math.random().toString(36).slice(2, 10)}`;
		this.logger = options.logger ?? NOOP_REMOTE_LOGGER;
		this.now = options.now ?? Date.now;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
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
			lastEventSequence: this.lastEventSequence,
			lastAckSequence: this.lastAckSequence,
			pendingRequestCount: this.pending.size,
			reconnectCount: this.reconnectCount,
			lastRttMs: this.lastRttMs,
			lastErrorCode: this.lastErrorCode,
		};
	}

	async connect(): Promise<void> {
		if (this.state === "online" || this.state === "connecting") return;
		this.setState(this.state === "idle" ? "connecting" : "reconnecting");
		try {
			await this.transport.connect({
				onFrame: (frame) => this.handleFrame(frame),
				onClose: (reason) => this.handleClose(reason),
			});
			await this.transport.send({
				type: "hello",
				protocolVersion: REMOTE_PROTOCOL_VERSION,
				role: this.options.role,
				deviceId: this.options.deviceId,
				deviceName: this.options.deviceName,
				capabilities: this.options.capabilities,
				connectionId: this.connectionId,
			});
		} catch (error) {
			this.setState("failed");
			throw error;
		}
		this.logger.info("remote connection handshake sent", {
			deviceId: this.options.deviceId,
			connectionId: this.connectionId,
		});
	}

	async close(): Promise<void> {
		if (this.state === "closed") return;
		this.rejectPending("remote connection closed");
		this.setState("closed");
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
			void this.transport.send(request).catch((error: unknown) => {
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
		await this.transport.send({ type: "response", requestId, ...response });
	}

	async emitEvent(name: RemoteEventName, payload?: unknown, sessionId?: string): Promise<RemoteEvent> {
		if (this.state !== "online") throw new Error(`remote connection is ${this.state}`);
		const sequence = ++this.outboundEventSequence;
		const event: RemoteEvent = {
			type: "event",
			eventId: `${this.connectionId}-event-${sequence}`,
			sequence,
			name,
			sessionId,
			payload,
		};
		this.outboundEvents.set(sequence, event);
		while (this.outboundEvents.size > 256) {
			const oldest = this.outboundEvents.keys().next().value;
			if (oldest === undefined) break;
			this.outboundEvents.delete(oldest);
		}
		await this.transport.send(event);
		return event;
	}

	private handleFrame(frame: RemoteFrame): void {
		const safeFrame = decodeRemoteFrame(frame);
		if (safeFrame.type === "hello_ack") {
			this.handleHelloAck(safeFrame);
			return;
		}
		if (safeFrame.type === "request") {
			this.emit({ type: "remote-request", request: safeFrame });
			return;
		}
		if (safeFrame.type === "response") {
			this.handleResponse(safeFrame);
			return;
		}
		if (safeFrame.type === "event") {
			this.handleEvent(safeFrame);
			return;
		}
		if (safeFrame.type === "ack") {
			this.lastAckSequence = Math.max(this.lastAckSequence, safeFrame.sequence);
			for (const sequence of this.outboundEvents.keys()) {
				if (sequence <= safeFrame.sequence) this.outboundEvents.delete(sequence);
			}
			return;
		}
		if (safeFrame.type === "resume") {
			for (const [sequence, event] of this.outboundEvents) {
				if (sequence > safeFrame.lastEventSequence) void this.transport.send(event);
			}
			return;
		}
		if (safeFrame.type === "hello") {
			this.logger.debug("remote frame is not handled by client connection", { type: safeFrame.type });
		}
	}

	private handleHelloAck(frame: RemoteHelloAck): void {
		// A relay can have more than one connection attempt in flight while a
		// client is recovering.  Only accept the acknowledgement for this
		// connection; a stale acknowledgement must not make the new transport
		// appear online.
		if (frame.connectionId !== this.connectionId) {
			this.logger.warn("remote hello acknowledgement belongs to another connection", {
				connectionId: this.connectionId,
				ackConnectionId: frame.connectionId,
			});
			return;
		}
		this.peerDeviceId = frame.peerDeviceId;
		this.setState("online");
		this.logger.info("remote connection online", {
			deviceId: this.options.deviceId,
			peerDeviceId: frame.peerDeviceId,
			connectionId: this.connectionId,
		});
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
			void this.transport
				.send({ type: "resume", lastEventSequence: this.lastEventSequence })
				.catch((error: unknown) => {
					this.logger.warn("remote event recovery request failed", {
						error: error instanceof Error ? error.message : String(error),
					});
				});
			return;
		}
		this.lastEventSequence = event.sequence;
		if (this.state === "recovering") this.setState("online");
		this.emit({ type: "remote-event", event });
		void this.transport.send({ type: "ack", sequence: event.sequence }).catch((error: unknown) => {
			this.logger.warn("remote event ack failed", {
				sequence: event.sequence,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}

	private handleClose(reason?: string): void {
		if (this.state === "closed") return;
		this.reconnectCount += 1;
		this.rejectPending("remote transport closed");
		this.logger.warn("remote transport closed", {
			deviceId: this.options.deviceId,
			connectionId: this.connectionId,
			reason,
			reconnectCount: this.reconnectCount,
		});
		this.setState("reconnecting");
	}

	private rejectPending(message: string): void {
		this.lastErrorCode = "transport_closed";
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
