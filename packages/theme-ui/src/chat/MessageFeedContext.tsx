import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";

interface MessageFeedState {
	footerHost: HTMLDivElement | null;
	setFooterHost: (element: HTMLDivElement | null) => void;
}
const MessageFeedContext = createContext<MessageFeedState | null>(null);

export function MessageFeedProvider({ children }: { readonly children: ReactNode }): JSX.Element {
	const [footerHost, setFooterHost] = useState<HTMLDivElement | null>(null);
	const value = useMemo(() => ({ footerHost, setFooterHost }), [footerHost]);
	return <MessageFeedContext.Provider value={value}>{children}</MessageFeedContext.Provider>;
}

export function useMessageFeedContext(part: string): MessageFeedState {
	const context = useContext(MessageFeedContext);
	if (!context) {
		throw new Error(`${part} must be used within MessageFeed.Root`);
	}
	return context;
}
