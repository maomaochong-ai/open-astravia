import { createContext, type ReactNode, useContext } from "react";
import { useOptionalConversationExtensionValue } from "../../conversation-view/extensions";

/** Extension id under which a conversation names the Runtime whose subagent cards it shows. */
export const SUBAGENT_CARDS_EXTENSION = "subagent-cards";

const SubagentSessionContext = createContext<string | null>(null);

/** Shows the subagent cards of `sessionId` below this subtree's tool calls, outside a conversation view. */
export function SubagentCardsScope({ sessionId, children }: { sessionId: string | null; children: ReactNode }): JSX.Element {
	return <SubagentSessionContext.Provider value={sessionId}>{children}</SubagentSessionContext.Provider>;
}

/** The Runtime whose subagent cards to show: an explicit scope, else the conversation's extension. */
export function useSubagentCardsSession(): string | null {
	const scoped = useContext(SubagentSessionContext);
	const registered = useOptionalConversationExtensionValue<string>(SUBAGENT_CARDS_EXTENSION);
	return scoped ?? registered ?? null;
}
