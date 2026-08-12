import { randomUUID } from "node:crypto";
import type {
	Clock,
	ContextStrategy,
	EventSink,
	IdGenerator,
	PreparedContext,
	RuntimeSnapshot,
	RuntimeSnapshotAcquireContext,
	RuntimeSnapshotLease,
	RuntimeSnapshotProvider,
	RuntimeTurnModelBindingProvider,
} from "./contracts.js";
import { bindRuntimeSnapshotForTurn } from "./runtime-snapshot-provider.js";

export class SystemClock implements Clock {
	now(): number {
		return Date.now();
	}
}

export class RandomIdGenerator implements IdGenerator {
	next(scope: "snapshot" | "turn"): string {
		return `${scope}-${randomUUID()}`;
	}
}

export class NoopEventSink implements EventSink {
	async publish(): Promise<void> {}
}

export class PassthroughContextStrategy implements ContextStrategy {
	async prepare(input: Parameters<ContextStrategy["prepare"]>[0], signal: AbortSignal): Promise<PreparedContext> {
		signal.throwIfAborted();
		return {
			messages: input.messages,
			estimatedTokens: 0,
		};
	}
}

export class StaticRuntimeSnapshotProvider implements RuntimeSnapshotProvider {
	constructor(
		private readonly snapshot: RuntimeSnapshot,
		private readonly modelBindingProvider?: RuntimeTurnModelBindingProvider,
	) {}

	async acquire(_context?: RuntimeSnapshotAcquireContext): Promise<RuntimeSnapshotLease> {
		const modelBinding = this.modelBindingProvider?.bind();
		const bound = _context ? await bindRuntimeSnapshotForTurn(this.snapshot, _context) : undefined;
		return {
			snapshot: bound?.snapshot ?? this.snapshot,
			...(modelBinding ? { modelBinding } : {}),
			release: bound?.release ?? (async () => {}),
		};
	}
}
