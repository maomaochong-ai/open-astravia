import type { ContextCompositionReport } from "./context-composition/contracts.js";
import type { SessionEventBase } from "./contracts.js";

/** A preflight over history, not a guarantee that a later provider call will succeed. */
export type ContextCompactionEligibility =
	| { readonly status: "eligible" }
	| { readonly status: "unknown" }
	| {
			readonly status: "ineligible";
			readonly reason: "no_history" | "insufficient_history" | "already_compacted" | "unsupported";
	  };

export interface SessionContextState {
	readonly sessionId: string;
	/** Monotonic within one live Runtime Session; never persisted across Runtime instances. */
	readonly revision: number;
	readonly usage: {
		readonly percent: number | null;
		readonly tokens: number | null;
		readonly contextWindow: number;
		readonly composition?: ContextCompositionReport;
	};
	readonly compaction: {
		readonly status: "idle" | "queued" | "running" | "completed" | "failed" | "cancelled";
		readonly eligibility: ContextCompactionEligibility;
		readonly queueId?: string;
		readonly errorMessage?: string;
	};
}

/** subscribe() delivers an initial snapshot and every subsequent committed projection. */
export interface SessionContextStateEvent extends SessionEventBase {
	readonly type: "session.context.state";
	readonly state: SessionContextState;
}
