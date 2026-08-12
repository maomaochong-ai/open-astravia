import type { CodingAgentExtensionRunnerPort } from "../../runtime-contracts/index.js";

interface RunnerGeneration {
	readonly sessionId: string;
	readonly runner: CodingAgentExtensionRunnerPort;
	bindingRefs: number;
	activeLeases: number;
	readonly turnLeaseCounts: Map<string, number>;
	retired: boolean;
	readonly waiters: Array<() => void>;
}

export interface ExtensionRunnerLease {
	readonly runner: CodingAgentExtensionRunnerPort;
	release(): void;
}

/** Shared owner that lets Event and Tool bindings retire one Runner only after all Turn leases drain. */
export class ExtensionRunnerGenerationOwner {
	private readonly current = new Map<string, RunnerGeneration>();
	private readonly retired = new Set<RunnerGeneration>();

	bind(
		sessionId: string,
		runner: CodingAgentExtensionRunnerPort,
		options: { readonly replaceExisting?: boolean } = {},
	): () => Promise<void> {
		let generation = this.current.get(sessionId);
		if (generation?.runner !== runner) {
			if (generation && options.replaceExisting !== true) {
				throw new Error(`Extension runner is already bound: ${sessionId}`);
			}
			if (generation) this.retire(generation);
			generation = {
				sessionId,
				runner,
				bindingRefs: 0,
				activeLeases: 0,
				turnLeaseCounts: new Map(),
				retired: false,
				waiters: [],
			};
			this.current.set(sessionId, generation);
		}
		generation.bindingRefs += 1;
		let disposed = false;
		return async () => {
			if (disposed) return;
			disposed = true;
			generation!.bindingRefs -= 1;
			if (generation!.bindingRefs === 0) {
				if (this.current.get(sessionId) === generation) this.current.delete(sessionId);
				this.retire(generation!);
			}
			await waitUntilUnused(generation!);
			this.retired.delete(generation!);
		};
	}

	acquire(sessionId: string, turnId?: string): ExtensionRunnerLease | undefined {
		const generation = this.current.get(sessionId);
		if (!generation || generation.retired) return undefined;
		generation.activeLeases += 1;
		if (turnId) generation.turnLeaseCounts.set(turnId, (generation.turnLeaseCounts.get(turnId) ?? 0) + 1);
		let released = false;
		return {
			runner: generation.runner,
			release: () => {
				if (released) return;
				released = true;
				generation.activeLeases -= 1;
				if (turnId) {
					const remaining = (generation.turnLeaseCounts.get(turnId) ?? 1) - 1;
					if (remaining > 0) generation.turnLeaseCounts.set(turnId, remaining);
					else generation.turnLeaseCounts.delete(turnId);
				}
				if (generation.activeLeases === 0) {
					for (const resolve of generation.waiters.splice(0)) resolve();
				}
			},
		};
	}

	ownsTurn(sessionId: string, turnId: string, runner: CodingAgentExtensionRunnerPort): boolean {
		for (const generation of this.generationsForSession(sessionId)) {
			if (generation.runner === runner && (generation.turnLeaseCounts.get(turnId) ?? 0) > 0) return true;
		}
		return false;
	}

	private retire(generation: RunnerGeneration): void {
		generation.retired = true;
		this.retired.add(generation);
	}

	private *generationsForSession(sessionId: string): Iterable<RunnerGeneration> {
		const current = this.current.get(sessionId);
		if (current) yield current;
		for (const generation of this.retired) {
			if (generation.sessionId === sessionId) yield generation;
		}
	}
}

async function waitUntilUnused(generation: RunnerGeneration): Promise<void> {
	if (generation.activeLeases === 0) return;
	await new Promise<void>((resolve) => generation.waiters.push(resolve));
}
