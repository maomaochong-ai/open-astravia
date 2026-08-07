import type { SubagentDeliveryMarker } from "./contracts.js";

export class SubagentDeliveryTracker {
	private readonly delivered = new Set<string>();

	isDelivered(id: string, generation: number): boolean {
		return this.delivered.has(this.key(id, generation));
	}

	tryClaim(id: string, generation: number): boolean {
		const key = this.key(id, generation);
		if (this.delivered.has(key)) return false;
		this.delivered.add(key);
		return true;
	}

	restore(markers: readonly SubagentDeliveryMarker[]): void {
		for (const marker of markers) this.delivered.add(this.key(marker.id, marker.generation));
	}

	private key(id: string, generation: number): string {
		return `${id}#${generation}`;
	}
}
