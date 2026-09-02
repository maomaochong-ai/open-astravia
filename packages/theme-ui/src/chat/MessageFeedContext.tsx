import type { ReactNode } from "react";
import { createContext, useContext } from "react";

const MessageFeedContext = createContext(false);

export function MessageFeedProvider({ children }: { readonly children: ReactNode }): JSX.Element {
	return <MessageFeedContext.Provider value>{children}</MessageFeedContext.Provider>;
}

export function useMessageFeedContext(part: string): void {
	if (!useContext(MessageFeedContext)) {
		throw new Error(`${part} must be used within MessageFeed.Root`);
	}
}
