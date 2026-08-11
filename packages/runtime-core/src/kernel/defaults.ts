import { randomUUID } from "node:crypto";
import type {
	Clock,
	ContextStrategy,
	EventSink,
	IdGenerator,
	PreparedContext,
	RuntimeSnapshot,
	RuntimeSnapshotLease,
	RuntimeSnapshotProvider,
} from "./contracts.js";

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
	constructor(private readonly snapshot: RuntimeSnapshot) {}

	async acquire(): Promise<RuntimeSnapshotLease> {
		return {
			snapshot: this.snapshot,
			async release() {},
		};
	}
}
