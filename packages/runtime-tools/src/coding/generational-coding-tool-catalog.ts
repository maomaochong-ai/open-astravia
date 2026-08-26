import type { CapabilityBinding, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import {
	CODING_TOOL_AVAILABILITY_ERROR_CODES,
	CodingToolAvailabilityError,
	type CodingToolAvailabilityErrorCode,
} from "./coding-tool-availability.js";
import type { CodingToolCatalog, CodingToolCatalogEntry } from "./coding-tool-catalog.js";

export interface GenerationalCodingToolCatalogOptions {
	readonly resolveAvailabilityErrorCode?: (toolName: string) => CodingToolAvailabilityErrorCode | undefined;
}

/** Keeps leased catalog generations executable while new Turns bind the latest published catalog. */
export class GenerationalCodingToolCatalog implements CodingToolCatalog {
	private currentGeneration: CatalogGeneration;
	private readonly generations = new Set<CatalogGeneration>();

	constructor(
		initial: CodingToolCatalog,
		private readonly options: GenerationalCodingToolCatalogOptions = {},
	) {
		this.currentGeneration = { catalog: initial, activeLeases: 0, retired: false };
		this.generations.add(this.currentGeneration);
	}

	publish(next: CodingToolCatalog): void {
		this.assertNoLeasedBindingCollisions(next);
		this.currentGeneration.retired = true;
		this.currentGeneration = { catalog: next, activeLeases: 0, retired: false };
		this.generations.add(this.currentGeneration);
		this.pruneGenerations();
	}

	snapshot() {
		return this.currentGeneration.catalog.snapshot();
	}

	acquireSnapshot(context?: Parameters<CodingToolCatalog["acquireSnapshot"]>[0]) {
		const generation = this.currentGeneration;
		generation.activeLeases += 1;
		let lease: ReturnType<CodingToolCatalog["acquireSnapshot"]>;
		try {
			lease = generation.catalog.acquireSnapshot(context);
		} catch (error) {
			generation.activeLeases -= 1;
			throw error;
		}
		let released = false;
		return {
			snapshot: lease.snapshot,
			release: async () => {
				if (released) return;
				released = true;
				try {
					await lease.release();
				} finally {
					generation.activeLeases -= 1;
					this.pruneGenerations();
				}
			},
		};
	}

	resolve(toolName: string): CodingToolCatalogEntry | undefined {
		return this.currentGeneration.catalog.resolve(toolName);
	}

	async execute(
		binding: CapabilityBinding,
		request: Parameters<CodingToolCatalog["execute"]>[1],
		implementation?: RuntimeToolDefinition,
	) {
		const errorCode = this.options.resolveAvailabilityErrorCode?.(binding.capabilityId);
		if (errorCode === CODING_TOOL_AVAILABILITY_ERROR_CODES.REVOKED) {
			throw new CodingToolAvailabilityError(errorCode, binding);
		}
		const generation = [...this.generations].find((candidate) => {
			const entry = candidate.catalog.resolve(binding.capabilityId);
			return entry ? sameBinding(entry.binding, binding) : false;
		});
		if (!generation) {
			throw new CodingToolAvailabilityError(CODING_TOOL_AVAILABILITY_ERROR_CODES.UNAVAILABLE, binding);
		}
		return generation.catalog.execute(binding, request, implementation);
	}

	private pruneGenerations(): void {
		for (const generation of this.generations) {
			if (generation.retired && generation.activeLeases === 0) this.generations.delete(generation);
		}
	}

	private assertNoLeasedBindingCollisions(next: CodingToolCatalog): void {
		const nextKeys = new Set(next.snapshot().entries.map(({ binding }) => bindingKey(binding)));
		for (const generation of this.generations) {
			if (generation.activeLeases === 0) continue;
			const collision = generation.catalog
				.snapshot()
				.entries.find(({ binding }) => nextKeys.has(bindingKey(binding)));
			if (collision) {
				throw new Error(`Published coding tool catalog reuses a leased binding: ${collision.binding.capabilityId}`);
			}
		}
	}
}

interface CatalogGeneration {
	readonly catalog: CodingToolCatalog;
	activeLeases: number;
	retired: boolean;
}

function sameBinding(left: CapabilityBinding, right: CapabilityBinding): boolean {
	return (
		left.sourceId === right.sourceId && left.capabilityId === right.capabilityId && left.revision === right.revision
	);
}

function bindingKey(binding: CapabilityBinding): string {
	return `${binding.sourceId}\u0000${binding.capabilityId}\u0000${binding.revision}`;
}
