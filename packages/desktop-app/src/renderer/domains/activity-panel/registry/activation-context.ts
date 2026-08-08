import { createContext, useContext } from "react";

const ActivityTabActivationContext = createContext(false);

export const ActivityTabActivationContextProvider = ActivityTabActivationContext.Provider;

export function useActivityTabActivation(): boolean {
	return useContext(ActivityTabActivationContext);
}
