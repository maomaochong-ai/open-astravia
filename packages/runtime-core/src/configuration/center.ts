import type { RuntimeObservationPublisher } from "../observation/index.js";
import type {
	RuntimeConfigurationCenterSnapshot,
	RuntimeConfigurationSnapshotAcquireContext,
	RuntimeConfigurationSnapshotLease,
	RuntimeConfigurationSnapshotSource,
} from "./contracts.js";
import { RuntimeConfigurationLayerRegistry, type RuntimeConfigurationLayerRegistryOptions } from "./layer-registry.js";
import { RuntimeConfigurationRegistry, type RuntimeConfigurationRegistryOptions } from "./registry.js";
import { RuntimeConfigurationResolver } from "./resolver.js";

export interface RuntimeConfigurationCenterOptions {
	readonly observationPublisher?: RuntimeObservationPublisher;
	readonly definitionRegistryOptions?: Omit<RuntimeConfigurationRegistryOptions, "observationPublisher">;
	readonly layerRegistryOptions?: Omit<RuntimeConfigurationLayerRegistryOptions, "observationPublisher">;
}

/** Definition 与动态 Layer 的通用组合根；不拥有产品设置、持久化或 UI。 */
export class RuntimeConfigurationCenter implements RuntimeConfigurationSnapshotSource {
	readonly definitions: RuntimeConfigurationRegistry;
	readonly layers: RuntimeConfigurationLayerRegistry;
	private readonly resolver: RuntimeConfigurationResolver;
	private closePromise: Promise<void> | undefined;

	constructor(options: RuntimeConfigurationCenterOptions = {}) {
		this.definitions = new RuntimeConfigurationRegistry({
			...options.definitionRegistryOptions,
			observationPublisher: options.observationPublisher,
		});
		this.layers = new RuntimeConfigurationLayerRegistry({
			...options.layerRegistryOptions,
			observationPublisher: options.observationPublisher,
		});
		this.resolver = new RuntimeConfigurationResolver(this.definitions, {
			observationPublisher: options.observationPublisher,
		});
	}

	acquire(_context?: RuntimeConfigurationSnapshotAcquireContext): RuntimeConfigurationSnapshotLease {
		return this.resolver.capture(this.layers.snapshot().layers);
	}

	snapshot(): RuntimeConfigurationCenterSnapshot {
		return Object.freeze({ definitions: this.definitions.snapshot(), layers: this.layers.snapshot() });
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.layers.close();
		this.closePromise = this.definitions.close();
		return this.closePromise;
	}
}
