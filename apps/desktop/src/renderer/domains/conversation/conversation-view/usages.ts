import type { Usage } from "@vetta/ai/protocol";
import { createContext } from "react";

const NO_USAGES: readonly Usage[] = [];

/** Usage of every reply in the conversation, for the per-reply usage comparison. */
export const ConversationUsagesContext = createContext<readonly Usage[]>(NO_USAGES);
