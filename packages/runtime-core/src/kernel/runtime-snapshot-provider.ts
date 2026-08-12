import type {
	AgentRunPreparer,
	CompiledRuntimeSnapshot,
	ContextStrategy,
	ContinuationPolicy,
	ModelCallContextTransformer,
	ModelCallContributionProvider,
	ModelCallFrameComposer,
	ModelCallMessageFinalizer,
	RuntimeInputRequestPreparer,
	RuntimeSnapshotAcquireContext,
	RuntimeSnapshotLease,
	RuntimeSnapshotProvider,
	RuntimeTurnModelBinding,
	RuntimeTurnModelBindingProvider,
} from "./contracts.js";
import { snapshotProviderClosedError } from "./errors.js";

interface SnapshotGeneration {
	readonly compiled: CompiledRuntimeSnapshot;
	activeLeases: number;
	retired: boolean;
	disposePromise?: Promise<void>;
	readonly unusedWaiters: Array<() => void>;
}

export class AtomicRuntimeSnapshotProvider implements RuntimeSnapshotProvider {
	private current: SnapshotGeneration;
	private readonly generations = new Set<SnapshotGeneration>();
	private closed = false;
	private closePromise?: Promise<void>;

	constructor(
		initial: CompiledRuntimeSnapshot,
		private readonly modelBindingProvider?: RuntimeTurnModelBindingProvider,
	) {
		this.current = createGeneration(initial);
		this.generations.add(this.current);
	}

	async acquire(context?: RuntimeSnapshotAcquireContext): Promise<RuntimeSnapshotLease> {
		if (this.closed) throw snapshotProviderClosedError();
		const generation = this.current;
		generation.activeLeases += 1;
		let snapshot = generation.compiled.snapshot;
		let releaseTurnBinding: (() => Promise<void>) | undefined;
		try {
			// Start every capture in the same JavaScript job. Each binder reads its
			// published pointer before its first await, preventing cross-domain drift.
			const [modelBindingResult, turnBindingResult] = await Promise.all([
				settle(() => this.modelBindingProvider?.bind(context)),
				settle(() => (context ? bindRuntimeSnapshotForTurn(snapshot, context) : undefined)),
			]);
			if (turnBindingResult.status === "fulfilled" && turnBindingResult.value) {
				snapshot = turnBindingResult.value.snapshot;
				releaseTurnBinding = turnBindingResult.value.release;
			}
			if (modelBindingResult.status === "rejected" || turnBindingResult.status === "rejected") {
				await releaseTurnBinding?.();
				const errors = [modelBindingResult, turnBindingResult]
					.filter((result): result is PromiseRejectedResult => result.status === "rejected")
					.map(({ reason }) => reason);
				throw errors.length === 1
					? errors[0]
					: new AggregateError(errors, "Failed to capture Turn runtime binding");
			}
			const modelBinding = modelBindingResult.value;
			return createSnapshotLease({
				snapshot,
				modelBinding,
				releaseTurnBinding,
				releaseGeneration: async () => {
					generation.activeLeases -= 1;
					if (generation.activeLeases === 0) {
						for (const resolve of generation.unusedWaiters.splice(0)) resolve();
					}
					await this.disposeIfRetired(generation);
				},
			});
		} catch (error) {
			generation.activeLeases -= 1;
			if (generation.activeLeases === 0) {
				for (const resolve of generation.unusedWaiters.splice(0)) resolve();
			}
			await this.disposeIfRetired(generation);
			throw error;
		}
	}

	async swap(next: CompiledRuntimeSnapshot): Promise<void> {
		if (this.closed) {
			await next.dispose();
			throw snapshotProviderClosedError();
		}

		const previous = this.current;
		const generation = createGeneration(next);
		this.generations.add(generation);
		this.current = generation;
		previous.retired = true;
		await this.disposeIfRetired(previous);
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closed = true;
		this.closePromise = this.disposeAll();
		return this.closePromise;
	}

	private async disposeAll(): Promise<void> {
		const generations = [...this.generations];
		for (const generation of generations) {
			generation.retired = true;
		}

		const results = await Promise.allSettled(
			generations.map(async (generation) => {
				await waitUntilUnused(generation);
				await this.disposeIfRetired(generation);
			}),
		);
		const errors = results
			.filter((result): result is PromiseRejectedResult => result.status === "rejected")
			.map(({ reason }) => reason);
		if (errors.length > 0) {
			throw new AggregateError(errors, "Failed to dispose one or more runtime snapshots");
		}
	}

	private async disposeIfRetired(generation: SnapshotGeneration): Promise<void> {
		if (!generation.retired || generation.activeLeases > 0) return;
		if (!generation.disposePromise) {
			generation.disposePromise = generation.compiled.dispose().finally(() => {
				this.generations.delete(generation);
			});
		}
		await generation.disposePromise;
	}
}

export async function bindRuntimeSnapshotForTurn(
	snapshot: CompiledRuntimeSnapshot["snapshot"],
	context: RuntimeSnapshotAcquireContext,
): Promise<{
	readonly snapshot: CompiledRuntimeSnapshot["snapshot"];
	readonly release: () => Promise<void>;
}> {
	context.signal.throwIfAborted();
	const [
		providerResults,
		composerResult,
		inputPreparerResult,
		agentRunPreparerResult,
		continuationPolicyResult,
		messageFinalizerResult,
		contextStrategyResult,
		contextTransformerResult,
	] = await Promise.all([
		Promise.all(
			(snapshot.modelCallProviders ?? []).map((provider) =>
				settle(() => (provider.bindForTurn ? provider.bindForTurn(context) : provider)),
			),
		),
		settle(() =>
			snapshot.modelCallFrameComposer?.bindForTurn
				? snapshot.modelCallFrameComposer.bindForTurn(context)
				: snapshot.modelCallFrameComposer,
		),
		settle(() =>
			snapshot.inputRequestPreparer?.bindForTurn
				? snapshot.inputRequestPreparer.bindForTurn(context)
				: snapshot.inputRequestPreparer,
		),
		settle(() =>
			snapshot.agentRunPreparer?.bindForTurn
				? snapshot.agentRunPreparer.bindForTurn(context)
				: snapshot.agentRunPreparer,
		),
		settle(() =>
			snapshot.continuationPolicy?.bindForTurn
				? snapshot.continuationPolicy.bindForTurn(context)
				: snapshot.continuationPolicy,
		),
		settle(() =>
			snapshot.modelCallMessageFinalizer?.bindForTurn
				? snapshot.modelCallMessageFinalizer.bindForTurn(context)
				: snapshot.modelCallMessageFinalizer,
		),
		settle(() =>
			snapshot.contextStrategy.bindForTurn
				? snapshot.contextStrategy.bindForTurn(context)
				: snapshot.contextStrategy,
		),
		settle(() =>
			snapshot.modelCallContextTransformer?.bindForTurn
				? snapshot.modelCallContextTransformer.bindForTurn(context)
				: snapshot.modelCallContextTransformer,
		),
	]);
	const modelCallProviders = snapshot.modelCallProviders
		? providerResults
				.filter(
					(result): result is PromiseFulfilledResult<ModelCallContributionProvider> =>
						result.status === "fulfilled",
				)
				.map(({ value }) => value)
		: undefined;
	const modelCallFrameComposer = composerResult.status === "fulfilled" ? composerResult.value : undefined;
	const inputRequestPreparer = inputPreparerResult.status === "fulfilled" ? inputPreparerResult.value : undefined;
	const agentRunPreparer = agentRunPreparerResult.status === "fulfilled" ? agentRunPreparerResult.value : undefined;
	const continuationPolicy =
		continuationPolicyResult.status === "fulfilled" ? continuationPolicyResult.value : undefined;
	const modelCallMessageFinalizer =
		messageFinalizerResult.status === "fulfilled" ? messageFinalizerResult.value : undefined;
	const contextStrategy = contextStrategyResult.status === "fulfilled" ? contextStrategyResult.value : undefined;
	const modelCallContextTransformer =
		contextTransformerResult.status === "fulfilled" ? contextTransformerResult.value : undefined;
	const release = createTurnBindingRelease(
		modelCallProviders,
		modelCallFrameComposer,
		inputRequestPreparer,
		agentRunPreparer,
		continuationPolicy,
		modelCallMessageFinalizer,
		contextStrategy,
		modelCallContextTransformer,
	);
	const bindingErrors = [
		...providerResults,
		composerResult,
		inputPreparerResult,
		agentRunPreparerResult,
		continuationPolicyResult,
		messageFinalizerResult,
		contextStrategyResult,
		contextTransformerResult,
	]
		.filter((result): result is PromiseRejectedResult => result.status === "rejected")
		.map(({ reason }) => reason);
	if (bindingErrors.length > 0) {
		await release();
		throw bindingErrors.length === 1
			? bindingErrors[0]
			: new AggregateError(bindingErrors, "Failed to bind runtime snapshot for Turn");
	}
	try {
		context.signal.throwIfAborted();
	} catch (error) {
		await release();
		throw error;
	}
	const boundSnapshot =
		modelCallProviders === snapshot.modelCallProviders &&
		modelCallFrameComposer === snapshot.modelCallFrameComposer &&
		inputRequestPreparer === snapshot.inputRequestPreparer &&
		agentRunPreparer === snapshot.agentRunPreparer &&
		continuationPolicy === snapshot.continuationPolicy &&
		modelCallMessageFinalizer === snapshot.modelCallMessageFinalizer &&
		contextStrategy === snapshot.contextStrategy &&
		modelCallContextTransformer === snapshot.modelCallContextTransformer
			? snapshot
			: Object.freeze({
					...snapshot,
					...(modelCallProviders ? { modelCallProviders: Object.freeze(modelCallProviders) } : {}),
					...(modelCallFrameComposer ? { modelCallFrameComposer } : {}),
					...(inputRequestPreparer ? { inputRequestPreparer } : {}),
					...(agentRunPreparer ? { agentRunPreparer } : {}),
					...(continuationPolicy ? { continuationPolicy } : {}),
					...(modelCallMessageFinalizer ? { modelCallMessageFinalizer } : {}),
					contextStrategy: contextStrategy ?? snapshot.contextStrategy,
					...(modelCallContextTransformer ? { modelCallContextTransformer } : {}),
				});
	return { snapshot: boundSnapshot, release };
}

function createTurnBindingRelease(
	providers: readonly ModelCallContributionProvider[] | undefined,
	composer: ModelCallFrameComposer | undefined,
	inputPreparer: RuntimeInputRequestPreparer | undefined,
	agentRunPreparer: AgentRunPreparer | undefined,
	continuationPolicy: ContinuationPolicy | undefined,
	messageFinalizer: ModelCallMessageFinalizer | undefined,
	contextStrategy: ContextStrategy | undefined,
	contextTransformer: ModelCallContextTransformer | undefined,
): () => Promise<void> {
	let released = false;
	return async () => {
		if (released) return;
		released = true;
		const resources = [
			...(providers ?? []),
			...(composer ? [composer] : []),
			...(inputPreparer ? [inputPreparer] : []),
			...(agentRunPreparer ? [agentRunPreparer] : []),
			...(continuationPolicy ? [continuationPolicy] : []),
			...(messageFinalizer ? [messageFinalizer] : []),
			...(contextStrategy ? [contextStrategy] : []),
			...(contextTransformer ? [contextTransformer] : []),
		];
		const results = await Promise.allSettled(resources.map((resource) => resource.releaseTurnBinding?.()));
		const errors = results
			.filter((result): result is PromiseRejectedResult => result.status === "rejected")
			.map(({ reason }) => reason);
		if (errors.length > 0) throw new AggregateError(errors, "Failed to release Turn-bound runtime resources");
	};
}

async function settle<T>(read: () => T | PromiseLike<T>): Promise<PromiseSettledResult<T>> {
	try {
		return { status: "fulfilled", value: await read() };
	} catch (reason) {
		return { status: "rejected", reason };
	}
}

function createGeneration(compiled: CompiledRuntimeSnapshot): SnapshotGeneration {
	return {
		compiled,
		activeLeases: 0,
		retired: false,
		unusedWaiters: [],
	};
}

async function waitUntilUnused(generation: SnapshotGeneration): Promise<void> {
	if (generation.activeLeases === 0) return;
	await new Promise<void>((resolve) => {
		generation.unusedWaiters.push(resolve);
	});
}

function createSnapshotLease(options: {
	readonly snapshot: RuntimeSnapshotLease["snapshot"];
	readonly modelBinding: RuntimeTurnModelBinding | undefined;
	readonly releaseTurnBinding: (() => Promise<void>) | undefined;
	readonly releaseGeneration: () => Promise<void>;
}): RuntimeSnapshotLease {
	let released = false;
	return {
		snapshot: options.snapshot,
		...(options.modelBinding ? { modelBinding: options.modelBinding } : {}),
		async release() {
			if (released) return;
			released = true;
			try {
				await options.releaseTurnBinding?.();
			} finally {
				await options.releaseGeneration();
			}
		},
	};
}
