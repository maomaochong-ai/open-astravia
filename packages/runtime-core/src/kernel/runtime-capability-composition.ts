import type {
	CompiledRuntimeSnapshot,
	RuntimeCapabilityDefinition,
	RuntimeSnapshotAcquireContext,
	RuntimeSnapshotLease,
	RuntimeSnapshotProvider,
	RuntimeTurnModelBindingProvider,
} from "./contracts.js";
import { snapshotProviderClosedError } from "./errors.js";
import { AtomicRuntimeSnapshotProvider } from "./runtime-snapshot-provider.js";

export interface RuntimeCapabilityCompiler {
	compile(definition: RuntimeCapabilityDefinition, signal: AbortSignal): Promise<CompiledRuntimeSnapshot>;
}

export interface RuntimeCapabilityCompositionOptions {
	readonly initialDefinition: RuntimeCapabilityDefinition;
	readonly compiler: RuntimeCapabilityCompiler;
	readonly modelBindingProvider?: RuntimeTurnModelBindingProvider;
	readonly signal?: AbortSignal;
}

export interface RuntimeCapabilityBindingDefinition {
	readonly definition: RuntimeCapabilityDefinition;
	readonly modelBindingProvider?: RuntimeTurnModelBindingProvider;
}

export type RuntimeCapabilityReconfigurationResult =
	| { readonly status: "applied"; readonly snapshotId: string }
	| { readonly status: "superseded" };

/**
 * 管理单个 Session 的结构性能力组合。
 *
 * 每个 Turn 仍通过 lease 绑定不可变快照；重配只替换后续 Turn 的快照。并发请求按
 * newest-wins 串行收敛，失败不会破坏当前可用代。
 */
export class RuntimeCapabilityComposition implements RuntimeSnapshotProvider {
	private readonly compiler: RuntimeCapabilityCompiler;
	private readonly provider: AtomicRuntimeSnapshotProvider;
	private modelBindingProvider?: RuntimeTurnModelBindingProvider;
	private requestedRevision = 0;
	private updateTail: Promise<void> = Promise.resolve();
	private closed = false;
	private closePromise: Promise<void> | undefined;

	private constructor(
		compiler: RuntimeCapabilityCompiler,
		initial: CompiledRuntimeSnapshot,
		modelBindingProvider?: RuntimeTurnModelBindingProvider,
	) {
		this.compiler = compiler;
		this.modelBindingProvider = modelBindingProvider;
		this.provider = new AtomicRuntimeSnapshotProvider(initial, modelBindingProvider);
	}

	static async create(options: RuntimeCapabilityCompositionOptions): Promise<RuntimeCapabilityComposition> {
		const signal = options.signal ?? new AbortController().signal;
		const initial = await options.compiler.compile(options.initialDefinition, signal);
		return new RuntimeCapabilityComposition(options.compiler, initial, options.modelBindingProvider);
	}

	acquire(context?: RuntimeSnapshotAcquireContext): Promise<RuntimeSnapshotLease> {
		return this.provider.acquire(context);
	}

	reconfigure(
		definition: RuntimeCapabilityDefinition,
		signal: AbortSignal = new AbortController().signal,
	): Promise<RuntimeCapabilityReconfigurationResult> {
		return this.enqueueReconfiguration({ definition }, true, signal);
	}

	/** 同代替换能力定义与模型绑定；当前 Turn 继续使用 acquire 时捕获的旧 generation。 */
	reconfigureBinding(
		binding: RuntimeCapabilityBindingDefinition,
		signal: AbortSignal = new AbortController().signal,
	): Promise<RuntimeCapabilityReconfigurationResult> {
		return this.enqueueReconfiguration(binding, false, signal);
	}

	private enqueueReconfiguration(
		binding: RuntimeCapabilityBindingDefinition,
		preserveModelBindingProvider: boolean,
		signal: AbortSignal,
	): Promise<RuntimeCapabilityReconfigurationResult> {
		if (this.closed) return Promise.reject(snapshotProviderClosedError());
		const revision = ++this.requestedRevision;
		const update = this.updateTail.then(async () => {
			if (this.closed) throw snapshotProviderClosedError();
			if (revision !== this.requestedRevision) return { status: "superseded" as const };
			signal.throwIfAborted();

			const compiled = await this.compiler.compile(binding.definition, signal);
			if (this.closed || revision !== this.requestedRevision) {
				await compiled.dispose();
				if (this.closed) throw snapshotProviderClosedError();
				return { status: "superseded" as const };
			}

			const modelBindingProvider = preserveModelBindingProvider
				? this.modelBindingProvider
				: binding.modelBindingProvider;
			await this.provider.swap(compiled, modelBindingProvider);
			this.modelBindingProvider = modelBindingProvider;
			return { status: "applied" as const, snapshotId: compiled.snapshot.id };
		});
		this.updateTail = update.then(
			() => undefined,
			() => undefined,
		);
		return update;
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closed = true;
		this.requestedRevision += 1;
		this.closePromise = this.updateTail.then(() => this.provider.close());
		return this.closePromise;
	}
}
