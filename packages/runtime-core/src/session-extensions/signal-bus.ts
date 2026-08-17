import type { SessionExtensionSignalToken } from "./contracts.js";

export type SessionExtensionSignalListener<Payload> = (payload: Payload) => void;

export class SessionExtensionSignalBus {
	private readonly listeners = new Map<string, Set<SessionExtensionSignalListener<unknown>>>();

	publish<Payload>(token: SessionExtensionSignalToken<Payload>, payload: Payload): void {
		for (const listener of this.listeners.get(token.id) ?? []) {
			try {
				listener(payload);
			} catch {
				// Signals are observations; listener failure cannot change extension state.
			}
		}
	}

	subscribe<Payload>(
		token: SessionExtensionSignalToken<Payload>,
		listener: SessionExtensionSignalListener<Payload>,
	): () => void {
		let listeners = this.listeners.get(token.id);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(token.id, listeners);
		}
		listeners.add(listener as SessionExtensionSignalListener<unknown>);
		return () => {
			listeners?.delete(listener as SessionExtensionSignalListener<unknown>);
			if (listeners?.size === 0) this.listeners.delete(token.id);
		};
	}

	clear(): void {
		this.listeners.clear();
	}
}
