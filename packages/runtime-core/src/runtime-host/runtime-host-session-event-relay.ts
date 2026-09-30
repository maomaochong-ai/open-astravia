import type { ErrorEvent, SessionEvent } from "../contracts.js";
import type { SessionContextStateEvent } from "../session-context-state.js";
import type { RuntimeHostQueueSidecar } from "./runtime-host-queue-sidecar.js";
import { baseSessionEvent, lifecycleSessionEvent, mapRuntimeSessionObservationEvent } from "./session-events.js";
import type { RuntimeSessionEventStream } from "./session-ports.js";
import type { InFlightBuffer, RunningChangedReason, RuntimeHostSessionRecord } from "./types.js";

export type RuntimeHostSessionEventRelayFailureComponent =
	| "running-listener"
	| "session-event-listener"
	| "session-error-observer"
	| "session-compaction-observer";

export interface RuntimeHostSessionEventRelayOptions {
	readonly queueSidecar: RuntimeHostQueueSidecar;
	readonly synchronizeSessionIdentity: (sessionKey: string, handle: RuntimeHostSessionRecord) => void;
	readonly sessionErrorObserver?: (event: ErrorEvent) => void;
	readonly sessionCompactionObserver?: (
		event: Extract<SessionEvent, { readonly type: "compaction.start" | "compaction.end" }>,
	) => void;
	readonly reportFailure: (
		operation: "listener.notify" | "observer.notify",
		component: RuntimeHostSessionEventRelayFailureComponent,
		error: unknown,
		sessionId?: string,
	) => void;
}

/**
 * RuntimeHost Session 事件的唯一回放、缓冲与外部广播边界。
 *
 * 该对象不执行 Turn，也不拥有 Backend；它只维护事件投影所需的瞬时状态，并把
 * subscriber/observer 失败隔离为安全 Observation。
 */
export class RuntimeHostSessionEventRelay {
	private readonly currentTurnStartedAt = new Map<string, number>();
	private readonly currentTurnIds = new Map<string, string>();
	private readonly inFlightBuffers = new Map<string, InFlightBuffer>();
	private readonly inFlightUnsubscribers = new Map<string, () => void>();
	private readonly externalSubscribers = new Map<string, Set<(event: SessionEvent) => void>>();
	private readonly externalSubscriberActiveToolFingerprints = new Map<
		string,
		WeakMap<(event: SessionEvent) => void, string>
	>();
	private readonly nextSequences = new Map<string, number>();
	private readonly runningSessionPaths = new Set<string>();
	private readonly runningChangedHandlers = new Set<
		(sessionPath: string, running: boolean, sessionId?: string, reason?: RunningChangedReason) => void
	>();
	private readonly contextStateEvents = new Map<string, SessionContextStateEvent>();

	constructor(private readonly options: RuntimeHostSessionEventRelayOptions) {}

	attach(sessionKey: string, handle: RuntimeHostSessionRecord, eventStream: RuntimeSessionEventStream): void {
		const buffer: InFlightBuffer = {
			turnStartedAt: 0,
			events: [],
			isActive: false,
			terminalReason: undefined,
		};
		this.inFlightBuffers.set(sessionKey, buffer);
		const unsubscribe = eventStream.subscribe((unsequencedEvent) => {
			const event = this.withSequence(sessionKey, unsequencedEvent);
			if (event.type === "session.context.state") this.contextStateEvents.set(sessionKey, event);
			this.options.synchronizeSessionIdentity(sessionKey, handle);
			this.observeSessionError(event);
			this.observeSessionCompaction(event);
			if (event.type === "queue.changed") {
				this.options.queueSidecar.persist(handle.lifecycle.sessionPath, event);
			}
			if (event.type === "conversation.turn.started") {
				this.currentTurnIds.set(sessionKey, event.turnId);
			} else if (
				(event.type === "conversation.turn.completed" ||
					event.type === "conversation.turn.cancelled" ||
					event.type === "conversation.turn.failed") &&
				this.currentTurnIds.get(sessionKey) === event.turnId
			) {
				this.currentTurnIds.delete(sessionKey);
			}
			if (event.type === "session.lifecycle" && event.phase === "agent_start") {
				this.currentTurnStartedAt.set(sessionKey, event.timestamp);
				buffer.turnStartedAt = event.timestamp;
				buffer.events = [];
				buffer.isActive = true;
				buffer.terminalReason = undefined;
				this.markRunning(handle.lifecycle.sessionPath, true, handle.lifecycle.sessionId);
			} else if (event.type === "session.lifecycle" && event.phase === "aborted") {
				buffer.terminalReason = "aborted";
			} else if (event.channel !== "assistant" && event.type === "error" && buffer.isActive) {
				buffer.terminalReason = "error";
			} else if (event.type === "session.lifecycle" && event.phase === "agent_end") {
				this.currentTurnStartedAt.delete(sessionKey);
				buffer.events = [];
				buffer.isActive = false;
				this.markRunning(
					handle.lifecycle.sessionPath,
					false,
					handle.lifecycle.sessionId,
					buffer.terminalReason ?? "agent_end",
				);
				buffer.terminalReason = undefined;
			} else if (event.type === "usage.update") {
				// A persisted assistant message ends the in-flight part of this model call.
				buffer.events = [];
			} else if (event.type === "model.request.started" && buffer.isActive) {
				buffer.events.push(event);
			} else if (
				(event.type === "tool.start" || event.type === "tool.phase" || event.type === "tool.end") &&
				buffer.isActive
			) {
				// Tool execution state is display-only and never persisted as a partial record;
				// a subscriber joining mid-Turn needs it to show running and finished tools.
				buffer.events.push(event);
			} else if (event.channel === "assistant" && buffer.isActive) {
				buffer.events.push(event);
				if (event.type === "error") buffer.terminalReason = "error";
				else if (event.type === "done") {
					// A later model call that finishes normally means the Turn recovered from
					// an earlier failed attempt; only the last call decides the Turn outcome.
					buffer.terminalReason = event.message.stopReason === "aborted" ? "aborted" : undefined;
				}
			}
			this.notifyExternalSubscribers(sessionKey, event);
		});
		this.inFlightUnsubscribers.set(sessionKey, unsubscribe);
	}

	subscribe(sessionKey: string, handle: RuntimeHostSessionRecord, handler: (event: SessionEvent) => void): () => void {
		const canonicalSessionId = handle.lifecycle.sessionId;
		this.notifyExternalSubscriber(sessionKey, handler, lifecycleSessionEvent(canonicalSessionId, "created"));

		for (const observation of handle.extensionHost?.readInitialObservations() ?? []) {
			this.notifyExternalSubscriber(
				sessionKey,
				handler,
				mapRuntimeSessionObservationEvent(canonicalSessionId, observation),
			);
		}

		this.notifyExternalSubscriber(sessionKey, handler, {
			...baseSessionEvent(canonicalSessionId, "runtime-core"),
			type: "active_tools_update",
			activeToolNames: [...handle.stateReader.readState().activeToolNames],
		});
		const contextState = this.contextStateEvents.get(sessionKey);
		if (contextState) this.notifyExternalSubscriber(sessionKey, handler, contextState);
		this.replayInFlight(sessionKey, canonicalSessionId, handler);

		let externals = this.externalSubscribers.get(sessionKey);
		if (!externals) {
			externals = new Set();
			this.externalSubscribers.set(sessionKey, externals);
		}
		externals.add(handler);

		return () => {
			const subscribers = this.externalSubscribers.get(sessionKey);
			if (!subscribers) return;
			subscribers.delete(handler);
			this.externalSubscriberActiveToolFingerprints.get(sessionKey)?.delete(handler);
			if (subscribers.size > 0) return;
			this.externalSubscribers.delete(sessionKey);
			this.externalSubscriberActiveToolFingerprints.delete(sessionKey);
		};
	}

	broadcastSyntheticEvent(sessionKey: string, event: SessionEvent): void {
		const sequencedEvent = this.withSequence(sessionKey, event);
		this.observeSessionError(sequencedEvent);
		this.notifyExternalSubscribers(sessionKey, sequencedEvent);
	}

	readCurrentTurnStartedAt(sessionKey: string): number | undefined {
		return this.currentTurnStartedAt.get(sessionKey);
	}

	/** Identity of the Turn currently running in this Session, from `conversation.turn.*` facts. */
	readCurrentTurnId(sessionKey: string): string | undefined {
		return this.currentTurnIds.get(sessionKey);
	}

	getRunningSessionPaths(): string[] {
		return Array.from(this.runningSessionPaths);
	}

	onRunningChanged(
		handler: (sessionPath: string, running: boolean, sessionId?: string, reason?: RunningChangedReason) => void,
	): () => void {
		this.runningChangedHandlers.add(handler);
		return () => this.runningChangedHandlers.delete(handler);
	}

	release(sessionKey: string, sessionPath: string | undefined, sessionId: string): void {
		this.detach(sessionKey);
		this.inFlightBuffers.delete(sessionKey);
		this.externalSubscribers.delete(sessionKey);
		this.externalSubscriberActiveToolFingerprints.delete(sessionKey);
		this.currentTurnStartedAt.delete(sessionKey);
		this.currentTurnIds.delete(sessionKey);
		this.nextSequences.delete(sessionKey);
		this.contextStateEvents.delete(sessionKey);
		this.markRunning(sessionPath, false, sessionId);
	}

	private replayInFlight(sessionKey: string, _sessionId: string, handler: (event: SessionEvent) => void): void {
		const buffer = this.inFlightBuffers.get(sessionKey);
		if (!buffer?.isActive) return;
		for (const event of buffer.events) {
			this.notifyExternalSubscriber(sessionKey, handler, event);
		}
	}

	private withSequence(sessionKey: string, event: SessionEvent): SessionEvent {
		const sequence = this.nextSequences.get(sessionKey) ?? 1;
		this.nextSequences.set(sessionKey, sequence + 1);
		return { ...event, sequence };
	}

	private notifyExternalSubscribers(sessionKey: string, event: SessionEvent): void {
		for (const handler of this.externalSubscribers.get(sessionKey) ?? []) {
			this.notifyExternalSubscriber(sessionKey, handler, event);
		}
	}

	private notifyExternalSubscriber(
		sessionKey: string,
		handler: (event: SessionEvent) => void,
		event: SessionEvent,
	): void {
		if (event.type === "active_tools_update") {
			const fingerprint = [...event.activeToolNames].sort().join("\0");
			let fingerprints = this.externalSubscriberActiveToolFingerprints.get(sessionKey);
			if (!fingerprints) {
				fingerprints = new WeakMap();
				this.externalSubscriberActiveToolFingerprints.set(sessionKey, fingerprints);
			}
			if (fingerprints.get(handler) === fingerprint) return;
			fingerprints.set(handler, fingerprint);
		}
		try {
			handler(event);
		} catch (error) {
			this.options.reportFailure("listener.notify", "session-event-listener", error, event.sessionId);
		}
	}

	private observeSessionError(event: SessionEvent): void {
		if (event.channel === "assistant" || event.type !== "error" || !this.options.sessionErrorObserver) return;
		try {
			this.options.sessionErrorObserver(event);
		} catch (error) {
			this.options.reportFailure("observer.notify", "session-error-observer", error, event.sessionId);
		}
	}

	private observeSessionCompaction(event: SessionEvent): void {
		if (
			(event.type !== "compaction.start" && event.type !== "compaction.end") ||
			!this.options.sessionCompactionObserver
		) {
			return;
		}
		try {
			this.options.sessionCompactionObserver(event);
		} catch (error) {
			this.options.reportFailure("observer.notify", "session-compaction-observer", error, event.sessionId);
		}
	}

	private markRunning(
		sessionPath: string | undefined,
		running: boolean,
		sessionId?: string,
		reason?: RunningChangedReason,
	): void {
		if (!sessionPath) return;
		const had = this.runningSessionPaths.has(sessionPath);
		if ((running && had) || (!running && !had)) return;
		if (running) this.runningSessionPaths.add(sessionPath);
		else this.runningSessionPaths.delete(sessionPath);
		for (const handler of this.runningChangedHandlers) {
			try {
				handler(sessionPath, running, sessionId, reason);
			} catch (error) {
				this.options.reportFailure("listener.notify", "running-listener", error, sessionId);
			}
		}
	}

	private detach(sessionKey: string): void {
		this.inFlightUnsubscribers.get(sessionKey)?.();
		this.inFlightUnsubscribers.delete(sessionKey);
	}
}
