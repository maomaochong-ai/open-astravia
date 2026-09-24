import type { RemoteEvent, RemoteEventJournalPort } from "./types.js";

export interface RemoteEventJournalOptions {
	/** Maximum events kept for replay; older ones are evicted and a resuming peer must resync. */
	readonly capacity?: number;
	/** Maximum age of a kept event in milliseconds. */
	readonly maxAgeMs?: number;
	readonly now?: () => number;
}

interface JournalEntry {
	readonly event: RemoteEvent;
	readonly recordedAt: number;
}

/**
 * Outbound event log owned by one endpoint for one peer. It outlives any
 * single transport so a peer that switches from LAN to relay (or reconnects)
 * keeps a continuous sequence and only receives what it missed. Bounded by
 * both count and age so an absent peer cannot make the desktop hold memory
 * indefinitely; beyond the bound the peer is told to reload instead.
 */
export class RemoteEventJournal implements RemoteEventJournalPort {
	private readonly entries: JournalEntry[] = [];
	private sequence = 0;
	private oldestKeptSequence = 0;
	private readonly capacity: number;
	private readonly maxAgeMs: number;
	private readonly now: () => number;

	constructor(options: RemoteEventJournalOptions = {}) {
		this.capacity = Math.max(1, options.capacity ?? 512);
		this.maxAgeMs = Math.max(0, options.maxAgeMs ?? 5 * 60_000);
		this.now = options.now ?? Date.now;
	}

	get lastSequence(): number {
		return this.sequence;
	}

	nextSequence(): number {
		this.sequence += 1;
		return this.sequence;
	}

	remember(event: RemoteEvent): void {
		this.entries.push({ event, recordedAt: this.now() });
		this.evict();
	}

	acknowledge(sequence: number): void {
		while (this.entries.length > 0 && this.entries[0]!.event.sequence <= sequence) this.entries.shift();
		this.oldestKeptSequence = Math.max(this.oldestKeptSequence, sequence);
	}

	replay(afterSequence: number): readonly RemoteEvent[] | undefined {
		this.evict();
		// Ahead of anything recorded here: this journal was recreated (the endpoint
		// restarted), and the peer would drop every new event as already seen.
		if (afterSequence > this.sequence) return undefined;
		if (afterSequence === this.sequence) return [];
		if (afterSequence < this.oldestKeptSequence) return undefined;
		return this.entries.filter((entry) => entry.event.sequence > afterSequence).map((entry) => entry.event);
	}

	private evict(): void {
		const cutoff = this.now() - this.maxAgeMs;
		while (this.entries.length > 0 && (this.entries.length > this.capacity || this.entries[0]!.recordedAt < cutoff)) {
			const evicted = this.entries.shift()!;
			this.oldestKeptSequence = Math.max(this.oldestKeptSequence, evicted.event.sequence);
		}
	}
}
