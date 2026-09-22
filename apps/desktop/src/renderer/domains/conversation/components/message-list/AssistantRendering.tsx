import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export interface AssistantRendering {
	readonly predicting: boolean;
}

const AssistantRenderingContext = createContext<AssistantRendering>({ predicting: false });

export function AssistantRenderingProvider({ value, children }: { value: AssistantRendering; children: ReactNode }) {
	return <AssistantRenderingContext.Provider value={value}>{children}</AssistantRenderingContext.Provider>;
}

export function useAssistantRendering(): AssistantRendering {
	return useContext(AssistantRenderingContext);
}
