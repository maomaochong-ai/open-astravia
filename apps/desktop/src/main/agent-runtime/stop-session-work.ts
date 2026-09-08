import { CODING_AGENT_WORK_STOP_ALL } from "@vetta/coding-agent/session-extensions";
import type { RuntimeHost } from "@vetta/runtime-core";

/**
 * Cascades a user stop into the work a turn spawned but does not own.
 *
 * Subagents, workflows and background commands outlive the turn that started them by
 * design, so cancelling the turn alone would leave them running behind the stop button.
 * Best effort: a session without the Coding Agent background work extension, or one
 * that already settled, simply has nothing to stop.
 */
export async function stopSessionBackgroundWork(runtime: RuntimeHost, sessionId: string): Promise<void> {
	try {
		if (!runtime.hasSessionExtension(sessionId, CODING_AGENT_WORK_STOP_ALL)) return;
		await runtime.invokeSessionExtension(sessionId, CODING_AGENT_WORK_STOP_ALL, undefined);
	} catch {
		// A stop must never fail on a session whose work already settled.
	}
}
