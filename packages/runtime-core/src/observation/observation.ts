import type {
	RuntimeObservationContext,
	RuntimeObservationFailure,
	RuntimeObservationPort,
	RuntimeObservationPublisher,
	RuntimeObservationPublisherOptions,
	RuntimeObservationRecord,
	RuntimeObservationToken,
} from "./contracts.js";

export function defineRuntimeObservation<Payload>(
	domain: string,
	event: string,
	level: RuntimeObservationToken<Payload>["level"] = "info",
): RuntimeObservationToken<Payload> {
	const normalizedDomain = requireObservationId(domain, "domain");
	const normalizedEvent = requireObservationId(event, "event");
	return Object.freeze({
		id: `${normalizedDomain}.${normalizedEvent}`,
		domain: normalizedDomain,
		event: normalizedEvent,
		level,
	});
}

export function createRuntimeObservationPublisher(
	options: RuntimeObservationPublisherOptions = {},
): RuntimeObservationPublisher {
	return new DefaultRuntimeObservationPublisher(
		options.port,
		freezeContext(options.context ?? {}),
		options.now ?? Date.now,
		options.onPortError,
	);
}

/** 将已 scope 的 Publisher 适配为父级 Port，供子 Hub 无损汇聚且不取得上层生命周期所有权。 */
export function createRuntimeObservationPublisherPort(publisher: RuntimeObservationPublisher): RuntimeObservationPort {
	return {
		record: (observation) => publisher.forward(observation),
		flush: () => publisher.flush(),
	};
}

export class NoopRuntimeObservationPort implements RuntimeObservationPort {
	record(): void {}
}

export class CompositeRuntimeObservationPort implements RuntimeObservationPort {
	constructor(private readonly ports: readonly RuntimeObservationPort[]) {}

	async record(observation: RuntimeObservationRecord): Promise<void> {
		await Promise.allSettled(
			this.ports.map(async (port) => {
				await port.record(observation);
			}),
		);
	}

	async flush(): Promise<void> {
		await Promise.allSettled(
			this.ports.map(async (port) => {
				await port.flush?.();
			}),
		);
	}
}

export function runtimeObservationFailure(error: unknown, signal?: AbortSignal): RuntimeObservationFailure {
	const cancelled = signal?.aborted === true || (error instanceof Error && error.name === "AbortError");
	const errorName = error instanceof Error ? error.name : "UnknownError";
	const code = readErrorCode(error);
	return Object.freeze({
		category: cancelled ? "cancelled" : "error",
		errorName,
		...(code ? { errorCode: code } : {}),
	});
}

class DefaultRuntimeObservationPublisher implements RuntimeObservationPublisher {
	constructor(
		private readonly port: RuntimeObservationPort | undefined,
		private readonly context: RuntimeObservationContext,
		private readonly now: () => number,
		private readonly onPortError?: (error: unknown) => void,
	) {}

	record<Payload>(
		token: RuntimeObservationToken<Payload>,
		payload: Payload,
		context: RuntimeObservationContext = {},
	): void {
		this.dispatch(
			Object.freeze({
				token,
				context: mergeContext(this.context, context),
				timestamp: this.now(),
				payload,
			}),
		);
	}

	forward(observation: RuntimeObservationRecord): void {
		this.dispatch(
			Object.freeze({
				...observation,
				context: mergeContext(this.context, observation.context),
			}),
		);
	}

	private dispatch(observation: RuntimeObservationRecord): void {
		if (!this.port) return;
		try {
			const result = this.port.record(observation);
			if (isPromiseLike(result)) void result.catch((error: unknown) => this.reportPortError(error));
		} catch (error) {
			this.reportPortError(error);
		}
	}

	scope(context: RuntimeObservationContext): RuntimeObservationPublisher {
		return new DefaultRuntimeObservationPublisher(
			this.port,
			mergeContext(this.context, context),
			this.now,
			this.onPortError,
		);
	}

	async flush(): Promise<void> {
		try {
			await this.port?.flush?.();
		} catch (error) {
			this.reportPortError(error);
		}
	}

	private reportPortError(error: unknown): void {
		try {
			this.onPortError?.(error);
		} catch {
			// Observation failures are deliberately isolated from the observed flow.
		}
	}
}

function mergeContext(
	base: RuntimeObservationContext,
	additional: RuntimeObservationContext,
): RuntimeObservationContext {
	return freezeContext({ ...additional, ...base });
}

function freezeContext(context: RuntimeObservationContext): RuntimeObservationContext {
	return Object.freeze({ ...context });
}

function requireObservationId(value: string, kind: string): string {
	const normalized = value.trim();
	if (!normalized || normalized !== value) {
		throw new Error(`Runtime observation ${kind} must be a non-empty trimmed string`);
	}
	return normalized;
}

function readErrorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || !("code" in error)) return undefined;
	const code = error.code;
	return typeof code === "string" || typeof code === "number" ? String(code).slice(0, 100) : undefined;
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		"then" in value &&
		typeof value.then === "function"
	);
}
