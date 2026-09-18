import { createContext, useContext, type ReactNode } from "react";

const SubagentSessionContext = createContext<string | null>(null);

export function SubagentCardsScope({ sessionId, children }: { sessionId: string | null; children: ReactNode }): JSX.Element {
	return <SubagentSessionContext.Provider value={sessionId}>{children}</SubagentSessionContext.Provider>;
}

export function useSubagentCardsSession(): string | null {
	return useContext(SubagentSessionContext);
}
