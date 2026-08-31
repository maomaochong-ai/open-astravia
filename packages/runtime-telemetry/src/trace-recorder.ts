import type { RuntimeObservationPort, RuntimeObservationRecord } from "@vetta/runtime-core/observation";
import type {
	RuntimeObservation,
	RuntimeObservationStartOptions,
	RuntimeObservationUpdate,
	RuntimeTracer,
} from "./index.js";
import {
	type RuntimeTraceRecord,
	safeTraceContext,
	safeTraceMetadata,
	safeTraceNumbers,
	traceIdentifier,
} from "./trace-record.js";

export interface RuntimeTraceRecorderOptions {
	readonly write: (record: RuntimeTraceRecord) => void;
	readonly flush: () => Promise<void>;
	readonly now?: () => number;
	readonly createId?: () => string;
	readonly maxOpenSpans?: number;
	readonly remote?: RuntimeTracer;
	readonly onIssue?: (code: "TRACE_ADAPTER_FAILED" | "TRACE_CAPACITY") => void;
}

/** Native Span tree plus flat Runtime events, with one privacy boundary for local and remote sinks. */
export class RuntimeTraceRecorder implements RuntimeTracer, RuntimeObservationPort {
	private readonly open = new Set<RuntimeObservation>();
	private readonly now: () => number;
	private readonly createId: () => string;
	private closed = false;
	private closeTask?: Promise<void>;
	constructor(private readonly options: RuntimeTraceRecorderOptions) {
		this.now = options.now ?? Date.now;
		this.createId = options.createId ?? (() => crypto.randomUUID());
	}
	startObservation(
		name: string,
		update?: RuntimeObservationUpdate,
		options?: RuntimeObservationStartOptions,
	): RuntimeObservation {
		return this.start(name, update, options, undefined, this.options.remote);
	}
	record(record: RuntimeObservationRecord): void {
		if (this.closed) return;
		const context = safeTraceContext(record.context);
		const metadata = safeTraceMetadata(record.payload);
		const id = this.createId();
		const event: RuntimeTraceRecord = {
			schemaVersion: 1,
			id,
			traceId: context.traceId ?? id,
			kind: "event",
			name: traceIdentifier(record.token.id) ?? "runtime.event",
			startedAt: record.timestamp,
			endedAt: record.timestamp,
			state: record.token.level === "error" || metadata.phase === "failed" ? "error" : "completed",
			context,
			metadata,
			usage: {},
			cost: {},
		};
		this.emit(event);
		this.attempt(() =>
			this.options.remote?.startObservation(event.name, remoteUpdate(event), { type: "event" }).end(),
		);
	}
	async flush(): Promise<void> {
		await Promise.all([
			this.attemptAsync(() => this.options.flush()),
			this.attemptAsync(() => this.options.remote?.flush?.()),
		]);
	}
	close(): Promise<void> {
		this.closeTask ??= this.closeOnce();
		return this.closeTask;
	}
	shutdown(): Promise<void> {
		return this.close();
	}
	private async closeOnce(): Promise<void> {
		this.closed = true;
		for (const observation of [...this.open])
			observation.end({ level: "ERROR", metadata: { status: "interrupted" } });
		await this.flush();
		await this.attemptAsync(() => this.options.remote?.shutdown?.());
	}
	private start(
		name: string,
		update: RuntimeObservationUpdate | undefined,
		options: RuntimeObservationStartOptions | undefined,
		parent: RuntimeTraceRecord | undefined,
		remoteParent: RuntimeTracer | RuntimeObservation | undefined,
	): RuntimeObservation {
		if (this.closed || this.open.size >= (this.options.maxOpenSpans ?? 1024)) {
			this.issue("TRACE_CAPACITY");
			return NOOP_OBSERVATION;
		}
		const id = this.createId();
		const traceId = parent?.traceId ?? this.createId();
		let record: RuntimeTraceRecord = {
			schemaVersion: 1,
			id,
			traceId,
			...(parent ? { parentSpanId: parent.id } : {}),
			kind: options?.type ?? "span",
			name: traceIdentifier(name) ?? "runtime.span",
			startedAt: this.now(),
			state: "running",
			context: {
				...parent?.context,
				...safeTraceContext(update?.metadata),
				...safeTraceContext({ sessionId: update?.sessionId }),
				traceId,
			},
			metadata: safeTraceMetadata({ model: update?.model, ...update?.metadata }),
			usage: safeTraceNumbers(update?.usageDetails),
			cost: safeTraceNumbers(update?.costDetails),
		};
		const remote = this.attempt(() =>
			remoteParent?.startObservation(record.name, remoteUpdate(record), { type: record.kind }),
		);
		let ended = false;
		const apply = (value: RuntimeObservationUpdate | undefined) => {
			record = {
				...record,
				metadata: { ...record.metadata, ...safeTraceMetadata(value?.metadata) },
				usage: { ...record.usage, ...safeTraceNumbers(value?.usageDetails) },
				cost: { ...record.cost, ...safeTraceNumbers(value?.costDetails) },
				state: value?.level === "ERROR" ? "error" : record.state,
			};
		};
		const observation: RuntimeObservation = {
			id,
			traceId,
			type: record.kind,
			startObservation: (childName, value, childOptions) =>
				ended ? NOOP_OBSERVATION : this.start(childName, value, childOptions, record, remote),
			update: (value) => {
				if (ended) return;
				apply(value);
				this.emit(record);
				this.attempt(() => remote?.update(remoteUpdate(record)));
			},
			end: (value) => {
				if (ended) return;
				ended = true;
				apply(value);
				record = {
					...record,
					endedAt: Math.max(record.startedAt, this.now()),
					state:
						record.metadata.status === "interrupted"
							? "interrupted"
							: record.state === "error"
								? "error"
								: "completed",
				};
				this.open.delete(observation);
				this.emit(record);
				this.attempt(() => remote?.end(remoteUpdate(record)));
			},
		};
		this.open.add(observation);
		this.emit(record);
		return observation;
	}
	private emit(record: RuntimeTraceRecord): void {
		this.attempt(() => this.options.write(record));
	}
	private attempt<T>(operation: () => T): T | undefined {
		try {
			return operation();
		} catch {
			this.issue("TRACE_ADAPTER_FAILED");
			return undefined;
		}
	}
	private async attemptAsync(operation: () => Promise<void> | undefined): Promise<void> {
		try {
			await operation();
		} catch {
			this.issue("TRACE_ADAPTER_FAILED");
		}
	}
	private issue(code: "TRACE_ADAPTER_FAILED" | "TRACE_CAPACITY"): void {
		try {
			this.options.onIssue?.(code);
		} catch {
			/* Diagnostics must remain outside execution. */
		}
	}
}

function remoteUpdate(record: RuntimeTraceRecord): RuntimeObservationUpdate {
	return {
		...(typeof record.metadata.model === "string" ? { model: record.metadata.model } : {}),
		sessionId: record.context.sessionId,
		level: record.state === "error" || record.state === "interrupted" ? "ERROR" : "DEFAULT",
		metadata: { ...record.metadata, ...record.context, localTraceId: record.traceId, localSpanId: record.id },
		usageDetails: { ...record.usage },
		costDetails: { ...record.cost },
	};
}
const NOOP_OBSERVATION: RuntimeObservation = {
	id: "dropped",
	traceId: "dropped",
	type: "span",
	startObservation: () => NOOP_OBSERVATION,
	update() {},
	end() {},
};
