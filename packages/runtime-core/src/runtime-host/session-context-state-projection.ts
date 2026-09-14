import type { SessionEvent } from "../contracts.js";
import type { ContextCompactionEligibility, SessionContextState } from "../session-context-state.js";
import type { RuntimeDynamicState } from "./runtime-session-projection.js";

/** Session-owned projection. Queue and execution events remain the sources of their own facts. */
export class SessionContextStateProjection {
	private state: SessionContextState | undefined;
	private running = false;
	private queueId: string | undefined;
	private result: "completed" | "failed" | "cancelled" | undefined;
	private errorMessage: string | undefined;
	private fingerprint = "";

	read(): SessionContextState | undefined {
		return this.state;
	}

	update(
		sessionId: string,
		dynamic: RuntimeDynamicState,
		eligibility: ContextCompactionEligibility,
		event?: SessionEvent,
	): SessionContextState | undefined {
		if (this.state && this.state.sessionId !== sessionId) {
			this.state = undefined;
			this.fingerprint = "";
			this.running = false;
			this.queueId = undefined;
			this.result = undefined;
			this.errorMessage = undefined;
		}
		if (event?.type === "queue.changed") {
			this.queueId = event.entries.find((entry) => entry.kind === "context_compaction")?.id;
		}
		if (event?.type === "compaction.start") {
			this.running = true;
			this.result = undefined;
			this.errorMessage = undefined;
		}
		if (event?.type === "compaction.end") {
			this.running = false;
			this.queueId = undefined;
			this.result = event.success ? "completed" : event.cancelled ? "cancelled" : "failed";
			this.errorMessage = event.errorMessage;
		}
		const data = {
			sessionId,
			usage: {
				percent: dynamic.contextPercent,
				tokens: dynamic.contextTokens ?? null,
				contextWindow: dynamic.contextWindow,
				...(dynamic.contextComposition ? { composition: dynamic.contextComposition } : {}),
			},
			compaction: {
				status: this.running
					? ("running" as const)
					: this.queueId
						? ("queued" as const)
						: (this.result ?? ("idle" as const)),
				eligibility,
				...(this.queueId ? { queueId: this.queueId } : {}),
				...(this.errorMessage ? { errorMessage: this.errorMessage } : {}),
			},
		};
		const fingerprint = JSON.stringify(data);
		if (fingerprint === this.fingerprint) return undefined;
		this.fingerprint = fingerprint;
		this.state = { ...data, revision: (this.state?.revision ?? 0) + 1 };
		return this.state;
	}
}
