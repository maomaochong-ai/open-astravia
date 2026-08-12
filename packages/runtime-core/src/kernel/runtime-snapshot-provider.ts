import type {
	CompiledRuntimeSnapshot,
	ModelCallContributionProvider,
	ModelCallFrameComposer,
	RuntimeSnapshotAcquireContext,
	RuntimeSnapshotLease,
	RuntimeSnapshotProvider,
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

	async acquire(_context?: RuntimeSnapshotAcquireContext): Promise<RuntimeSnapshotLease> {
		if (this.closed) throw snapshotProviderClosedError();
		const generation = this.current;
		const modelBinding = this.modelBindingProvider?.bind();
		generation.activeLeases += 1;
		let released = false;
		let snapshot = generation.compiled.snapshot;
		let releaseTurnBinding: (() => Promise<void>) | undefined;
		try {
			if (_context) {
				const bound = await bindRuntimeSnapshotForTurn(snapshot, _context);
				snapshot = bound.snapshot;
				releaseTurnBinding = bound.release;
			}
		} catch (error) {
			generation.activeLeases -= 1;
			if (generation.activeLeases === 0) {
				for (const resolve of generation.unusedWaiters.splice(0)) resolve();
			}
			await this.disposeIfRetired(generation);
			throw error;
		}

		return {
			snapshot,
			...(modelBinding ? { modelBinding } : {}),
			release: async () => {
				if (released) return;
				released = true;
				try {
					await releaseTurnBinding?.();
				} finally {
					generation.activeLeases -= 1;
					if (generation.activeLeases === 0) {
						for (const resolve of generation.unusedWaiters.splice(0)) resolve();
					}
					await this.disposeIfRetired(generation);
				}
			},
		};
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
	const [providerResults, composerResult] = await Promise.all([
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
	const release = createTurnBindingRelease(modelCallProviders, modelCallFrameComposer);
	const bindingErrors = [...providerResults, composerResult]
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
		modelCallProviders === snapshot.modelCallProviders && modelCallFrameComposer === snapshot.modelCallFrameComposer
			? snapshot
			: Object.freeze({
					...snapshot,
					...(modelCallProviders ? { modelCallProviders: Object.freeze(modelCallProviders) } : {}),
					...(modelCallFrameComposer ? { modelCallFrameComposer } : {}),
				});
	return { snapshot: boundSnapshot, release };
}

function createTurnBindingRelease(
	providers: readonly ModelCallContributionProvider[] | undefined,
	composer: ModelCallFrameComposer | undefined,
): () => Promise<void> {
	let released = false;
	return async () => {
		if (released) return;
		released = true;
		const resources = [...(providers ?? []), ...(composer ? [composer] : [])];
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
