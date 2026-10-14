import { createContext, useContext, type PropsWithChildren } from "react";

export type OpenProjectSession = (cwd: string, sessionPath?: string) => Promise<void>;

const SessionOpenContext = createContext<OpenProjectSession | null>(null);

export function SessionOpenProvider({
	children,
	onOpenSession,
}: PropsWithChildren<{ onOpenSession: OpenProjectSession }>): JSX.Element {
	return <SessionOpenContext.Provider value={onOpenSession}>{children}</SessionOpenContext.Provider>;
}

export function useOpenProjectSession(): OpenProjectSession {
	const open = useContext(SessionOpenContext);
	if (!open) throw new Error("SessionOpenProvider is required");
	return open;
}
