import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { RendererMarkdownModel } from "@shared/models/renderer-markdown-model";

const RendererMarkdownContext = createContext<RendererMarkdownModel | null>(null);
export function RendererMarkdownScope({ value, children }: { value: RendererMarkdownModel; children: ReactNode }) {
	return <RendererMarkdownContext.Provider value={value}>{children}</RendererMarkdownContext.Provider>;
}
export function useRendererMarkdownScope() {
	return useContext(RendererMarkdownContext);
}
