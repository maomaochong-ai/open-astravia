import { createContext, type ReactNode, useContext } from "react";
import type { ContentCreationPluginRuntime } from "./runtime";

// Runtime identity belongs to the activation that registered the rendered contribution,
// so a retiring hot-reload activation cannot replace or clear the new dependency graph.
const ContentCreationRuntimeContext = createContext<ContentCreationPluginRuntime | null>(null);

export function ContentCreationRuntimeProvider({
	runtime,
	children,
}: {
	runtime: ContentCreationPluginRuntime;
	children: ReactNode;
}) {
	return (
		<ContentCreationRuntimeContext.Provider value={runtime}>
			{children}
		</ContentCreationRuntimeContext.Provider>
	);
}

export function useContentCreationRuntime(): ContentCreationPluginRuntime {
	const runtime = useContext(ContentCreationRuntimeContext);
	if (!runtime) throw new Error("Content creation components require an activation runtime provider");
	return runtime;
}
