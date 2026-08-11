import type { CompiledRuntimeSnapshot, RuntimeSnapshotLease, RuntimeSnapshotProvider } from "./contracts.js";
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

	constructor(initial: CompiledRuntimeSnapshot) {
		this.current = createGeneration(initial);
		this.generations.add(this.current);
	}

	async acquire(): Promise<RuntimeSnapshotLease> {
		if (this.closed) throw snapshotProviderClosedError();
		const generation = this.current;
		generation.activeLeases += 1;
		let released = false;

		return {
			snapshot: generation.compiled.snapshot,
			release: async () => {
				if (released) return;
				released = true;
				generation.activeLeases -= 1;
				if (generation.activeLeases === 0) {
					for (const resolve of generation.unusedWaiters.splice(0)) resolve();
				}
				await this.disposeIfRetired(generation);
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
