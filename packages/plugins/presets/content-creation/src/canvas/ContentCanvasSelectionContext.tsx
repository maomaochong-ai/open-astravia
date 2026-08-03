import { createContext, useContext, type ReactNode } from "react";

const ContentCanvasSelectionContext = createContext(0);

interface ContentCanvasSelectionProviderProps {
	count: number;
	children: ReactNode;
}

export function ContentCanvasSelectionProvider({ count, children }: ContentCanvasSelectionProviderProps) {
	return <ContentCanvasSelectionContext.Provider value={count}>{children}</ContentCanvasSelectionContext.Provider>;
}

export function useContentCanvasSelectionCount(): number {
	return useContext(ContentCanvasSelectionContext);
}
