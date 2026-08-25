import type {
	RuntimeConfigurationSnapshotAcquireContext,
	RuntimeConfigurationSnapshotLease,
	RuntimeConfigurationSnapshotSource,
} from "./contracts.js";
import { invalidRuntimeConfigurationLayerError } from "./errors.js";

interface SharedBinding {
	readonly lease: RuntimeConfigurationSnapshotLease;
	activeConsumers: number;
}

/** 让同一 bindingId 的多个 Capability 共享同一个配置 generation，并在最后一个消费者释放时回收。 */
export class RuntimeConfigurationSnapshotCoordinator implements RuntimeConfigurationSnapshotSource {
	private readonly bindings = new Map<string, SharedBinding>();

	constructor(private readonly source: RuntimeConfigurationSnapshotSource) {}

	acquire(context?: RuntimeConfigurationSnapshotAcquireContext): RuntimeConfigurationSnapshotLease {
		if (!context) return this.source.acquire();
		context.signal?.throwIfAborted();
		const bindingId = createBindingKey(context.scopeId, context.bindingId);
		let binding = this.bindings.get(bindingId);
		if (!binding) {
			binding = { lease: this.source.acquire(context), activeConsumers: 0 };
			this.bindings.set(bindingId, binding);
		}
		binding.activeConsumers += 1;
		let released = false;
		return Object.freeze({
			snapshot: binding.lease.snapshot,
			release: async () => {
				if (released) return;
				released = true;
				binding.activeConsumers -= 1;
				if (binding.activeConsumers > 0) return;
				this.bindings.delete(bindingId);
				await binding.lease.release();
			},
		});
	}
}

function normalizeBindingId(value: string, label: string): string {
	if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
		throw invalidRuntimeConfigurationLayerError(
			`Runtime Configuration snapshot ${label} must be a non-empty trimmed string`,
		);
	}
	return value;
}

function createBindingKey(scopeId: string | undefined, bindingId: string): string {
	const binding = normalizeBindingId(bindingId, "binding id");
	return scopeId === undefined ? binding : `${normalizeBindingId(scopeId, "scope id")}\u0000${binding}`;
}
