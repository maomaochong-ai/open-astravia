import type { LogEvent } from "./host-protocol.js";

/**
 * Fixed-capacity ring buffer for sidecar log events. Keeps the most recent
 * `capacity` entries; the IM Settings page reads from this buffer when the
 * user opens the "view recent logs" drawer.
 *
 * Subscribers receive every appended log; they're expected to be cheap
 * (renderer push or filter-and-discard). The buffer never blocks on slow
 * subscribers — they just see the live stream from now-on.
 */
export class LogBuffer {
	private items: LogEvent[] = [];
	private subscribers = new Set<(event: LogEvent) => void>();

	constructor(private readonly capacity: number) {}

	push(event: LogEvent): void {
		this.items.push(event);
		if (this.items.length > this.capacity) {
			this.items.splice(0, this.items.length - this.capacity);
		}
		for (const sub of this.subscribers) {
			try {
				sub(event);
			} catch {
				// ignore subscriber errors so one bad listener doesn't
				// poison the rest of the pipeline
			}
		}
	}

	snapshot(): LogEvent[] {
		// Return newest-first so the UI renders without an extra reverse.
		return [...this.items].reverse();
	}

	subscribe(handler: (event: LogEvent) => void): () => void {
		this.subscribers.add(handler);
		return () => {
			this.subscribers.delete(handler);
		};
	}

	clear(): void {
		this.items = [];
	}
}
