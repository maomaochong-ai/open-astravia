import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import type { TurnObserver } from "@vetta/runtime-core/kernel";

export function createEcosystemHookTurnObserver(
	hookRuntime: Pick<EcosystemHookRuntime, "finishCurrentTurn">,
): TurnObserver {
	return {
		id: "coding-agent.ecosystem-hook-turn-lifecycle",
		async observe(event) {
			if (event.type === "turn.completed" || event.type === "turn.cancelled" || event.type === "turn.failed") {
				hookRuntime.finishCurrentTurn();
			}
		},
	};
}
