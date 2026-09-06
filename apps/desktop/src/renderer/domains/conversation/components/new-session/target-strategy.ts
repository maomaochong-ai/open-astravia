import type { SendInteractionContext } from "../input-bar/types";
import { CONVERSATION_TARGET_KEY, type NewSessionTargetKey } from "./target";

export type NewSessionDispatch = (overrideText?: string, context?: SendInteractionContext) => Promise<void>;

export interface NewSessionTargetStrategy {
	readonly key: NewSessionTargetKey;
	readonly dispatch: NewSessionDispatch;
}

export interface NewSessionTargetStrategyRegistry {
	readonly resolve: (targetKey: NewSessionTargetKey | null) => NewSessionTargetStrategy;
}

/**
 * Strategy registry for the new-session send contract. The page never decides
 * which IPC chain to call; it only resolves the selected target and dispatches.
 */
export function createNewSessionTargetStrategyRegistry(input: {
	readonly conversationDispatch: NewSessionDispatch;
	readonly teamDispatch: NewSessionDispatch;
	readonly teamKey: NewSessionTargetKey | null;
}): NewSessionTargetStrategyRegistry {
	const conversation: NewSessionTargetStrategy = {
		key: CONVERSATION_TARGET_KEY,
		dispatch: input.conversationDispatch,
	};
	const strategies = new Map<string, NewSessionTargetStrategy>([[conversation.key, conversation]]);
	if (input.teamKey) strategies.set(input.teamKey, { key: input.teamKey, dispatch: input.teamDispatch });
	return {
		resolve: (targetKey) => {
			const key = targetKey ?? CONVERSATION_TARGET_KEY;
			return (
				strategies.get(key) ?? {
					key,
					dispatch: async () => {
						throw new Error(`Unknown new-session target: ${key}`);
					},
				}
			);
		},
	};
}
