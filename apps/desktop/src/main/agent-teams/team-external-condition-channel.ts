import type { TeamExternalConditionChange } from "@vetta/agent-team";

export interface TeamExternalConditionChangeChannel {
	publish(change: TeamExternalConditionChange): void;
	subscribe(listener: (change: TeamExternalConditionChange) => void): () => void;
}

/**
 * Process-local host signal. It carries no credentials or billing data; it only
 * states that a condition changed, leaving durable matching/retry to Team services.
 */
function createTeamExternalConditionChangeChannel(): TeamExternalConditionChangeChannel {
	const listeners = new Set<(change: TeamExternalConditionChange) => void>();
	return {
		publish(change) {
			for (const listener of listeners) listener(change);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export const agentTeamExternalConditionChanges = createTeamExternalConditionChangeChannel();
