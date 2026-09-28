import type { SessionEvent } from "@vetta/runtime-core";

export type SessionTurnNotificationOutcome = "completed" | "failed";

/** Collapses noisy runtime events into at most one user-facing terminal outcome per turn. */
export class SessionTurnNotificationController {
	private lastStopReason: string | undefined;
	private aborted = false;

	handle(event: SessionEvent): SessionTurnNotificationOutcome | null {
		if (event.type === "message.final") {
			const stopReason = (event.message as unknown as { stopReason?: unknown }).stopReason;
			if (typeof stopReason === "string") this.lastStopReason = stopReason;
		} else if (event.channel === "assistant" && (event.type === "done" || event.type === "error")) {
			this.lastStopReason = event.type === "done" ? event.message.stopReason : "error";
		} else if (event.channel !== "assistant" && event.type === "error") {
			this.lastStopReason = "error";
		} else if (event.type === "session.lifecycle") {
			if (event.phase === "aborted") {
				this.aborted = true;
			} else if (event.phase === "agent_end") {
				const wasAborted = this.aborted || this.lastStopReason === "aborted";
				const outcome = this.lastStopReason === "error" ? "failed" : "completed";
				this.lastStopReason = undefined;
				this.aborted = false;
				return wasAborted ? null : outcome;
			}
		}
		return null;
	}
}
