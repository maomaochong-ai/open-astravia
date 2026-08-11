import type {
	AgentProfile,
	CompiledRuntimeSnapshot,
	RuntimeSnapshotLease,
	RuntimeSnapshotProvider,
} from "./contracts.js";
import { snapshotProviderClosedError } from "./errors.js";
import { AtomicRuntimeSnapshotProvider } from "./runtime-snapshot-provider.js";

export interface RuntimeProfileCompiler {
	compile(profile: AgentProfile, signal: AbortSignal): Promise<CompiledRuntimeSnapshot>;
}

export interface RuntimeCapabilityCompositionOptions {
	readonly initialProfile: AgentProfile;
	readonly compiler: RuntimeProfileCompiler;
	readonly signal?: AbortSignal;
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
	private readonly compiler: RuntimeProfileCompiler;
	private readonly provider: AtomicRuntimeSnapshotProvider;
	private requestedRevision = 0;
	private updateTail: Promise<void> = Promise.resolve();
	private closed = false;
	private closePromise: Promise<void> | undefined;

	private constructor(compiler: RuntimeProfileCompiler, initial: CompiledRuntimeSnapshot) {
		this.compiler = compiler;
		this.provider = new AtomicRuntimeSnapshotProvider(initial);
	}

	static async create(options: RuntimeCapabilityCompositionOptions): Promise<RuntimeCapabilityComposition> {
		const signal = options.signal ?? new AbortController().signal;
		const initial = await options.compiler.compile(options.initialProfile, signal);
		return new RuntimeCapabilityComposition(options.compiler, initial);
	}

	acquire(): Promise<RuntimeSnapshotLease> {
		return this.provider.acquire();
	}

	reconfigure(
		profile: AgentProfile,
		signal: AbortSignal = new AbortController().signal,
	): Promise<RuntimeCapabilityReconfigurationResult> {
		if (this.closed) return Promise.reject(snapshotProviderClosedError());
		const revision = ++this.requestedRevision;
		const update = this.updateTail.then(async () => {
			if (this.closed) throw snapshotProviderClosedError();
			if (revision !== this.requestedRevision) return { status: "superseded" as const };
			signal.throwIfAborted();

			const compiled = await this.compiler.compile(profile, signal);
			if (this.closed || revision !== this.requestedRevision) {
				await compiled.dispose();
				if (this.closed) throw snapshotProviderClosedError();
				return { status: "superseded" as const };
			}

			await this.provider.swap(compiled);
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
