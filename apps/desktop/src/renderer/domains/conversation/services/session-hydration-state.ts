import {
	type ContextUsageData,
	contextUsageAtom,
	lastTurnUsageAtom,
	modelSupportsImagesAtom,
	type SessionExecutionMode,
	selectedModelAtom,
	sessionAgentModeAtom,
	sessionExecutionModeAtom,
	type TurnUsageData,
} from "@shared/store/chat-atoms";
import { activeToolNamesAtom, currentScenarioAtom } from "@shared/store/plugin-atoms";
import type { ConversationScenario } from "@vetta-org/plugin-sdk";
import { atom } from "jotai";

export interface SessionHydrationState {
	activeToolNames: readonly string[];
	agentMode: string | null;
	contextUsage: ContextUsageData;
	executionMode: SessionExecutionMode;
	lastTurnUsage: TurnUsageData | null;
	modelSupportsImages: boolean;
	scenario: ConversationScenario;
	selectedModel?: string;
}

/** Commit one Runtime snapshot as one Jotai transaction. */
export const applySessionHydrationStateAtom = atom(null, (_get, set, state: SessionHydrationState) => {
	set(contextUsageAtom, state.contextUsage);
	set(modelSupportsImagesAtom, state.modelSupportsImages);
	set(sessionExecutionModeAtom, state.executionMode);
	set(activeToolNamesAtom, new Set(state.activeToolNames));
	set(currentScenarioAtom, state.scenario);
	set(sessionAgentModeAtom, state.agentMode);
	set(lastTurnUsageAtom, state.lastTurnUsage);
	if (state.selectedModel !== undefined) set(selectedModelAtom, state.selectedModel);
});
